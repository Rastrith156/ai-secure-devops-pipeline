import { basename, byBasename, findFiles, lineForIndex, lineForPattern, makeIssue, splitLines } from "./common.js";

const DOCKER_STAGE = "docker";

export function analyzeDockerAndCi(files, project) {
  const issues = [];
  const dockerfiles = findFiles(files, (name) => basename(name).toLowerCase() === "dockerfile");
  const jenkinsfiles = findFiles(files, (name) => basename(name).toLowerCase() === "jenkinsfile");
  const workflows = findFiles(files, (name) => /(^|\/)\.github\/workflows\/.+\.ya?ml$/i.test(name));

  issues.push(...analyzeDockerfiles(files, dockerfiles, project));
  issues.push(...analyzeJenkinsfiles(jenkinsfiles));
  issues.push(...analyzeGitHubActions(workflows, dockerfiles));

  if (jenkinsfiles.length === 0 && workflows.length === 0 && hasApplicationCode(project)) {
    issues.push(
      makeIssue(
        DOCKER_STAGE,
        "low",
        "No CI configuration detected",
        "project",
        "A DevOps pipeline needs a committed CI definition so tests and scans run on every change.",
        "Add Jenkinsfile or .github/workflows/ci.yml with install, test, security, quality, and build stages."
      )
    );
  }

  return issues;
}

function analyzeDockerfiles(files, dockerfiles, project) {
  const issues = [];

  if (dockerfiles.length === 0) {
    if (hasApplicationCode(project)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "low",
          "No Dockerfile detected",
          "project",
          "Containerized delivery is easier to reproduce when the build definition is versioned.",
          "Add a Dockerfile with a pinned base image, non-root USER, HEALTHCHECK, and minimal COPY commands."
        )
      );
    }
    return issues;
  }

  dockerfiles.forEach((dockerfile) => {
    const content = dockerfile.content;

    if (/^\s*FROM\s+\S+(:latest)?\s*$/im.test(content)) {
      const fromLine = splitLines(content).find((line) => /^\s*FROM\s+/i.test(line)) || "";
      if (!/:([\w.-]+)(\s+AS\s+\w+)?$/i.test(fromLine.trim()) || /:latest(\s+AS\s+\w+)?$/i.test(fromLine.trim())) {
        issues.push(
          makeIssue(
            DOCKER_STAGE,
            "medium",
            "Docker base image is not pinned",
            `${dockerfile.filename}:${lineForPattern(content, /^\s*FROM\s+/im)}`,
            "Floating base images can change between builds and introduce unexpected vulnerabilities.",
            "Pin the base image to a specific version or digest, for example:\nFROM python:3.12.4-slim@sha256:<digest>"
          )
        );
      }
    }

    if (/^\s*COPY\s+(\.|\*|\$PWD)\s+(\.|\S+)/im.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "medium",
          "Dockerfile copies the entire project context",
          `${dockerfile.filename}:${lineForPattern(content, /^\s*COPY\s+(\.|\*|\$PWD)\s+(\.|\S+)/im)}`,
          "COPY . . can include secrets, tests, local caches, and files that should not be inside the image.",
          "Copy dependency manifests first, install dependencies, then copy only required source directories."
        )
      );
    }

    if (!/^\s*USER\s+\S+/im.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "high",
          "Container runs as root",
          dockerfile.filename,
          "Without a USER instruction, most images run as root by default.",
          "Create and switch to an unprivileged user:\nRUN adduser --disabled-password --gecos \"\" appuser\nUSER appuser"
        )
      );
    } else if (/^\s*USER\s+(root|0)\b/im.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "high",
          "Dockerfile explicitly switches to root",
          `${dockerfile.filename}:${lineForPattern(content, /^\s*USER\s+(root|0)\b/im)}`,
          "Running application processes as root increases the impact of a container escape or write bug.",
          "Switch to a named unprivileged user for the final runtime stage."
        )
      );
    }

    if (!/^\s*HEALTHCHECK\b/im.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "medium",
          "Dockerfile has no healthcheck",
          dockerfile.filename,
          "Schedulers and operators need a reliable way to detect unhealthy containers.",
          "Add a lightweight HEALTHCHECK, for example:\nHEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/health || exit 1"
        )
      );
    }

    if (/^\s*ADD\s+/im.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "low",
          "Dockerfile uses ADD where COPY is safer",
          `${dockerfile.filename}:${lineForPattern(content, /^\s*ADD\s+/im)}`,
          "ADD has extra remote URL and archive extraction behavior that reviewers may not expect.",
          "Use COPY unless you specifically need ADD's archive extraction behavior."
        )
      );
    }

    if (/^\s*RUN\s+.*(curl|wget).*\|\s*(sh|bash)/im.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "high",
          "Docker build pipes remote script into a shell",
          `${dockerfile.filename}:${lineForPattern(content, /^\s*RUN\s+.*(curl|wget).*\|\s*(sh|bash)/im)}`,
          "Piping downloaded content directly to a shell bypasses review and integrity checks.",
          "Download a pinned artifact, verify its checksum or signature, then execute a checked script."
        )
      );
    }

    if (/^\s*RUN\s+.*pip\s+install\b(?!.*--no-cache-dir)/im.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "low",
          "pip install does not disable cache",
          `${dockerfile.filename}:${lineForPattern(content, /^\s*RUN\s+.*pip\s+install\b/im)}`,
          "pip cache increases image size and can leave unnecessary package artifacts behind.",
          "Use pip install --no-cache-dir -r requirements.txt."
        )
      );
    }

    if (/^\s*RUN\s+.*npm\s+install\b/im.test(content) && byBasename(files, "package-lock.json")) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "medium",
          "Docker build uses npm install instead of npm ci",
          `${dockerfile.filename}:${lineForPattern(content, /^\s*RUN\s+.*npm\s+install\b/im)}`,
          "npm ci is faster and reproducible when a package-lock.json is committed.",
          "Use npm ci --omit=dev for production images or npm ci for test images."
        )
      );
    }
  });

  issues.push(...analyzeDockerignore(files, dockerfiles[0]));
  return issues;
}

function analyzeDockerignore(files, dockerfile) {
  const issues = [];
  const dockerignore = byBasename(files, ".dockerignore");

  if (!dockerignore) {
    issues.push(
      makeIssue(
        DOCKER_STAGE,
        "medium",
        "No .dockerignore found",
        dockerfile.filename,
        "Docker may send secrets, git history, dependencies, and build outputs into the build context.",
        "Add .dockerignore with entries such as:\n.git\n.env*\nnode_modules\nvenv\n__pycache__\ndist\nbuild\ncoverage"
      )
    );
    return issues;
  }

  const lines = splitLines(dockerignore.content).map((line) => line.trim()).filter(Boolean);
  const required = [".git", ".env", "node_modules"];
  const missing = required.filter((item) => !lines.some((line) => line === item || line === `${item}*` || line === `${item}/`));

  if (missing.length) {
    issues.push(
      makeIssue(
        DOCKER_STAGE,
        "low",
        ".dockerignore misses common sensitive paths",
        dockerignore.filename,
        `Missing entries: ${missing.join(", ")}.`,
        `Add these entries to .dockerignore:\n${missing.join("\n")}`
      )
    );
  }

  return issues;
}

function analyzeJenkinsfiles(jenkinsfiles) {
  const issues = [];

  jenkinsfiles.forEach((jenkinsfile) => {
    const content = jenkinsfile.content;

    if (/\|\|\s*true\b/i.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "high",
          "Jenkins stage suppresses command failure",
          `${jenkinsfile.filename}:${lineForPattern(content, /\|\|\s*true\b/i)}`,
          "Using || true can hide failed tests, scans, and deployment commands.",
          "Remove || true and let the command fail the stage. Fix the underlying command or handle expected nonzero codes explicitly."
        )
      );
    }

    const trivyMatches = [...content.matchAll(/trivy\s+(image|fs|repo)[^\n]*/gi)];
    trivyMatches.forEach((match) => {
      if (!/--exit-code\s+1\b/.test(match[0])) {
        issues.push(
          makeIssue(
            DOCKER_STAGE,
            "high",
            "Trivy scan does not fail the pipeline",
            `${jenkinsfile.filename}:${lineForIndex(content, match.index)}`,
            "A vulnerability scan that never exits nonzero only produces logs, not protection.",
            "Make Trivy fail on serious findings:\ntrivy image --exit-code 1 --severity HIGH,CRITICAL image:tag"
          )
        );
      }
    });

    if (!/stage\s*\(\s*['"]test['"]\s*\)/i.test(content) && !/\b(pytest|npm\s+test|mvn\s+test|gradle\s+test)\b/i.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "medium",
          "Jenkinsfile has no clear test stage",
          jenkinsfile.filename,
          "A pipeline should run tests before packaging or deployment.",
          "Add a Test stage that runs the project's real test command and fails on errors."
        )
      );
    }

    if (!/\btimeout\s*\(/i.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "low",
          "Jenkinsfile has no stage timeout",
          jenkinsfile.filename,
          "Hung scans or network installs can block shared CI agents.",
          "Wrap long-running stages with timeout, for example:\ntimeout(time: 10, unit: 'MINUTES') { sh 'npm test' }"
        )
      );
    }

    if (/\bsudo\b/.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "medium",
          "Jenkinsfile uses sudo",
          `${jenkinsfile.filename}:${lineForPattern(content, /\bsudo\b/)}`,
          "sudo in CI usually means the agent has broad privileges and builds are harder to isolate.",
          "Move privileged setup into the agent image or use a restricted CI service account."
        )
      );
    }
  });

  return issues;
}

function analyzeGitHubActions(workflows, dockerfiles) {
  const issues = [];

  workflows.forEach((workflow) => {
    const content = workflow.content;

    if (/continue-on-error\s*:\s*true/i.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "high",
          "GitHub Actions step allows failures",
          `${workflow.filename}:${lineForPattern(content, /continue-on-error\s*:\s*true/i)}`,
          "continue-on-error can make a broken security or test step look successful.",
          "Remove continue-on-error or scope it to an explicitly non-blocking informational job."
        )
      );
    }

    if (!/permissions\s*:/i.test(content)) {
      issues.push(
        makeIssue(
          DOCKER_STAGE,
          "low",
          "GitHub Actions workflow does not set token permissions",
          workflow.filename,
          "The default GITHUB_TOKEN permissions may be broader than the workflow needs.",
          "Add least-privilege permissions, for example:\npermissions:\n  contents: read"
        )
      );
    }
  });

  if (dockerfiles.length && workflows.length && !workflows.some((workflow) => /\b(trivy|grype|snyk|docker\s+scan)\b/i.test(workflow.content))) {
    issues.push(
      makeIssue(
        DOCKER_STAGE,
        "medium",
        "Container workflow lacks an image security scan",
        "project",
        "The project builds containers but no GitHub Actions workflow appears to scan them.",
        "Add a blocking image scan step with Trivy, Grype, Snyk, or another scanner configured to fail on high severity findings."
      )
    );
  }

  return issues;
}

function hasApplicationCode(project) {
  const labels = new Set(project.labels || []);
  return ["Python", "Node", "Java", "Go", "Ruby"].some((label) => labels.has(label));
}
