import { byBasename, findFiles, hasAnyFile, lineForIndex, lineForPattern, makeIssue, parseJsonFile } from "./common.js";

const DEP_STAGE = "install";

export function analyzeDependencies(files, project) {
  const issues = [];
  const labels = new Set(project.labels || []);

  issues.push(...analyzePythonDependencies(files, labels));
  issues.push(...analyzeNodeDependencies(files, labels));
  issues.push(...analyzeJavaDependencies(files, labels));

  return issues;
}

function analyzePythonDependencies(files, labels) {
  const issues = [];
  const requirements = byBasename(files, "requirements.txt");
  const pyproject = byBasename(files, "pyproject.toml");
  const pipfile = byBasename(files, "Pipfile");
  const hasPythonSource = hasAnyFile(files, (name) => name.endsWith(".py"));

  if ((labels.has("Python") || hasPythonSource) && !requirements && !pyproject && !pipfile) {
    issues.push(
      makeIssue(
        DEP_STAGE,
        "high",
        "Python project has no dependency manifest",
        "project",
        "The pipeline cannot reproduce installs without requirements.txt, pyproject.toml, or Pipfile.",
        "Create requirements.txt with exact package pins, for example:\nflask==3.0.2\npytest==8.2.2"
      )
    );
  }

  if (requirements) {
    const lines = requirements.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const clean = line.replace(/\s+#.*$/, "").trim();
      if (!clean || clean.startsWith("#") || clean.startsWith("-r ") || clean.startsWith("--")) return;
      if (/^(git\+|https?:\/\/)/i.test(clean)) {
        issues.push(
          makeIssue(
            DEP_STAGE,
            "high",
            "Remote Python dependency is not immutable",
            `${requirements.filename}:${index + 1}`,
            "Installing directly from a URL can change without warning unless it is pinned to a commit hash.",
            "Pin the dependency to a commit SHA or replace it with a released package version."
          )
        );
        return;
      }

      if (!isPinnedPythonRequirement(clean)) {
        issues.push(
          makeIssue(
            DEP_STAGE,
            isWildcardVersion(clean) ? "high" : "medium",
            "Python dependency is not exactly pinned",
            `${requirements.filename}:${index + 1}`,
            "Unpinned packages can install different code on every pipeline run.",
            `Pin this requirement with an exact version, for example:\n${extractPackageName(clean)}==<known-good-version>`
          )
        );
      }
    });
  }

  if (pyproject) {
    const dependencyMatches = [...pyproject.content.matchAll(/["']([^"'\n]+?)([<>=~!]=?|==|\*)[^"'\n]*["']/g)];
    dependencyMatches.forEach((match) => {
      const dep = match[0].slice(1, -1);
      if (!isPinnedPythonRequirement(dep)) {
        issues.push(
          makeIssue(
            DEP_STAGE,
            "medium",
            "pyproject dependency is not exactly pinned",
            `${pyproject.filename}:${lineForIndex(pyproject.content, match.index)}`,
            "Version ranges in pyproject.toml make builds less reproducible.",
            `Use an exact version in pyproject.toml, for example:\n"${extractPackageName(dep)}==<known-good-version>"`
          )
        );
      }
    });
  }

  return issues;
}

function analyzeNodeDependencies(files, labels) {
  const issues = [];
  const pkg = byBasename(files, "package.json");
  const hasNodeSource = hasAnyFile(files, (name) => /\.(m?js|cjs|jsx|ts|tsx)$/i.test(name));

  if ((labels.has("Node") || hasNodeSource) && !pkg) {
    issues.push(
      makeIssue(
        DEP_STAGE,
        "high",
        "Node project has no package.json",
        "project",
        "The install stage cannot restore dependencies or scripts reliably without package.json.",
        "Run npm init -y, then commit package.json and a lockfile."
      )
    );
    return issues;
  }

  if (!pkg) return issues;

  const parsed = parseJsonFile(pkg);
  if (!parsed.ok) {
    issues.push(
      makeIssue(
        DEP_STAGE,
        "high",
        "package.json is invalid JSON",
        `${pkg.filename}:1`,
        "Package managers and CI jobs will fail before tests or security checks can run.",
        "Fix the JSON syntax and validate it with:\nnode -e \"JSON.parse(require('fs').readFileSync('package.json','utf8'))\""
      )
    );
    return issues;
  }

  const packageJson = parsed.value;
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.optionalDependencies || {})
  };

  Object.entries(dependencies).forEach(([name, version]) => {
    if (!isPinnedNodeVersion(String(version))) {
      issues.push(
        makeIssue(
          DEP_STAGE,
          isWildcardVersion(String(version)) ? "high" : "medium",
          "Node dependency is not exactly pinned",
          `${pkg.filename}:${lineForPattern(pkg.content, new RegExp(`"${escapeRegExp(name)}"\\s*:`))}`,
          `Dependency ${name} uses version "${version}", which can resolve to different packages over time.`,
          `Pin ${name} to an exact version and refresh the lockfile:\nnpm install ${name}@<known-good-version> --save-exact`
        )
      );
    }
  });

  const hasLockfile = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"].some((name) => byBasename(files, name));
  if (!hasLockfile) {
    issues.push(
      makeIssue(
        DEP_STAGE,
        "medium",
        "Node project has no lockfile",
        pkg.filename,
        "Without a committed lockfile, CI installs can drift from a student's local machine.",
        "Commit exactly one lockfile, for example:\nnpm install --package-lock-only\n# then commit package-lock.json"
      )
    );
  }

  const scripts = packageJson.scripts || {};
  ["preinstall", "install", "postinstall"].forEach((scriptName) => {
    const script = String(scripts[scriptName] || "");
    if (/(curl|wget|Invoke-WebRequest|powershell|bash\s+-c).*(sh|http)/i.test(script)) {
      issues.push(
        makeIssue(
          DEP_STAGE,
          "high",
          "Install script downloads and executes remote content",
          `${pkg.filename}:${lineForPattern(pkg.content, new RegExp(`"${scriptName}"\\s*:`))}`,
          "Remote install hooks are a supply-chain risk and can execute before tests or scanners run.",
          "Replace the install hook with a checked-in script or a trusted package manager command."
        )
      );
    }
  });

  if (!packageJson.engines && labels.has("Node")) {
    issues.push(
      makeIssue(
        DEP_STAGE,
        "low",
        "Node runtime version is not declared",
        pkg.filename,
        "CI, local machines, and hosting platforms may use different Node versions.",
        "Add an engines field, for example:\n\"engines\": { \"node\": \">=20 <23\" }"
      )
    );
  }

  return issues;
}

function analyzeJavaDependencies(files, labels) {
  const issues = [];
  const pom = byBasename(files, "pom.xml");
  const gradleFiles = findFiles(files, (name) => /(^|\/)build\.gradle(\.kts)?$/i.test(name));

  if (!labels.has("Java") && !pom && gradleFiles.length === 0) return issues;

  if (!pom && gradleFiles.length === 0) {
    issues.push(
      makeIssue(
        DEP_STAGE,
        "medium",
        "Java project has no build manifest",
        "project",
        "A Java pipeline needs Maven or Gradle metadata to install dependencies and run tests.",
        "Commit pom.xml or build.gradle with pinned plugin and dependency versions."
      )
    );
  }

  if (pom) {
    const dependencyBlocks = [...pom.content.matchAll(/<dependency>[\s\S]*?<\/dependency>/gi)];
    dependencyBlocks.forEach((match) => {
      const block = match[0];
      if (!/<version>[^<]+<\/version>/i.test(block) && !/<scope>test<\/scope>/i.test(block)) {
        issues.push(
          makeIssue(
            DEP_STAGE,
            "medium",
            "Maven dependency has no explicit version",
            `${pom.filename}:${lineForIndex(pom.content, match.index)}`,
            "Dependencies without versions rely on inherited metadata that may be unclear to reviewers.",
            "Declare the version in the dependency or centralize it in dependencyManagement."
          )
        );
      }
    });
  }

  gradleFiles.forEach((gradle) => {
    const dynamicMatches = [...gradle.content.matchAll(/['"][^'"]+:(latest\.release|latest\.integration|\+)[^'"]*['"]/gi)];
    dynamicMatches.forEach((match) => {
      issues.push(
        makeIssue(
          DEP_STAGE,
          "high",
          "Gradle dependency uses a dynamic version",
          `${gradle.filename}:${lineForIndex(gradle.content, match.index)}`,
          "Dynamic Gradle versions can pull unreviewed code into the pipeline.",
          "Replace latest.release, latest.integration, or + with an exact released version."
        )
      );
    });
  });

  return issues;
}

function isPinnedPythonRequirement(requirement) {
  if (/@\s*(file|git\+ssh|git\+https):/i.test(requirement)) return /@[a-f0-9]{12,}/i.test(requirement);
  return /^[A-Za-z0-9_.-]+(\[[^\]]+\])?===[^=]+$/.test(requirement) || /^[A-Za-z0-9_.-]+(\[[^\]]+\])?==[^=]+$/.test(requirement);
}

function isPinnedNodeVersion(version) {
  if (/^(file:|link:|workspace:|npm:)/i.test(version)) return true;
  return /^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/.test(version);
}

function isWildcardVersion(version) {
  return /(^|\s)(latest|\*|x|X)(\s|$)/.test(version) || /\+$/.test(version);
}

function extractPackageName(requirement) {
  return requirement.split(/[<>=~!@\s;]/)[0].replace(/\[.*$/, "") || "package";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
