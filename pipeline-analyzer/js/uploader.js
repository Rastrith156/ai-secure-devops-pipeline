const MAX_FILE_BYTES = 850_000;
const MAX_TOTAL_BYTES = 4_000_000;

const IGNORED_PATH = /(^|\/)(node_modules|\.git|\.hg|\.svn|venv|\.venv|env|__pycache__|dist|build|coverage|target|vendor|\.tox|\.mypy_cache|\.pytest_cache)(\/|$)/i;

const KEEP_EXTENSIONS = new Set([
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".yaml",
  ".yml",
  ".env",
  ".sh",
  ".bash",
  ".txt",
  ".toml",
  ".ini",
  ".cfg",
  ".xml",
  ".gradle",
  ".properties",
  ".lock"
]);

const KEEP_BASENAMES = new Set([
  "dockerfile",
  "jenkinsfile",
  "makefile",
  "requirements.txt",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pom.xml",
  "build.gradle",
  "go.mod",
  "gemfile",
  "pipfile",
  "pyproject.toml",
  ".gitignore",
  ".dockerignore",
  ".env",
  ".env.example",
  ".npmrc"
]);

export async function extractZip(zipFile, options = {}) {
  const { onProgress = () => {} } = options;

  if (!window.JSZip) {
    throw new Error("JSZip did not load. Check the CDN script or network connection.");
  }

  const zip = await window.JSZip.loadAsync(zipFile);
  const entries = [];

  zip.forEach((rawPath, entry) => {
    if (!entry.dir) {
      entries.push({
        entry,
        filename: normalizePath(rawPath),
        size: entry?._data?.uncompressedSize ?? 0
      });
    }
  });

  const files = [];
  const skipped = [];
  let totalBytes = 0;
  let completed = 0;

  for (const item of entries.sort((a, b) => a.filename.localeCompare(b.filename))) {
    const skip = getSkipReason(item.filename, item.size, totalBytes);

    if (skip) {
      skipped.push({ filename: item.filename, reason: skip });
      completed += 1;
      onProgress(entries.length ? completed / entries.length : 1);
      continue;
    }

    try {
      const content = await item.entry.async("string");

      if (content.includes("\u0000")) {
        skipped.push({ filename: item.filename, reason: "binary content" });
      } else {
        const byteSize = new Blob([content]).size;
        if (byteSize > MAX_FILE_BYTES) {
          skipped.push({ filename: item.filename, reason: "file too large" });
        } else if (totalBytes + byteSize > MAX_TOTAL_BYTES) {
          skipped.push({ filename: item.filename, reason: "scan size limit reached" });
        } else {
          totalBytes += byteSize;
          files.push({ filename: item.filename, content, size: byteSize });
        }
      }
    } catch (error) {
      skipped.push({ filename: item.filename, reason: error.message || "read failed" });
    }

    completed += 1;
    onProgress(entries.length ? completed / entries.length : 1);
  }

  return {
    files,
    skipped,
    project: detectProjectType(files),
    meta: {
      zipName: zipFile.name,
      zipSize: zipFile.size,
      totalEntries: entries.length,
      keptBytes: totalBytes
    }
  };
}

export function detectProjectType(files) {
  const names = new Set(files.map((file) => file.filename.toLowerCase()));
  const hasName = (name) => names.has(name.toLowerCase()) || files.some((file) => basename(file.filename).toLowerCase() === name.toLowerCase());
  const hasExt = (ext) => files.some((file) => file.filename.toLowerCase().endsWith(ext));
  const hasPath = (pattern) => files.some((file) => pattern.test(file.filename));

  const labels = [];
  const signals = [];

  if (hasName("requirements.txt") || hasName("pyproject.toml") || hasName("Pipfile") || hasExt(".py")) {
    labels.push("Python");
    signals.push(hasName("requirements.txt") ? "requirements.txt" : "Python files");
  }

  if (hasName("package.json") || hasExt(".js") || hasExt(".ts")) {
    labels.push("Node");
    signals.push(hasName("package.json") ? "package.json" : "JavaScript/TypeScript files");
  }

  if (hasName("pom.xml") || hasName("build.gradle") || hasExt(".java")) {
    labels.push("Java");
    signals.push(hasName("pom.xml") ? "pom.xml" : "Java/Gradle files");
  }

  if (hasName("go.mod") || hasExt(".go")) {
    labels.push("Go");
    signals.push(hasName("go.mod") ? "go.mod" : "Go files");
  }

  if (hasName("Gemfile") || hasExt(".rb")) {
    labels.push("Ruby");
    signals.push(hasName("Gemfile") ? "Gemfile" : "Ruby files");
  }

  if (hasName("Dockerfile") || hasPath(/(^|\/)dockerfile$/i)) {
    labels.push("Docker");
    signals.push("Dockerfile");
  }

  if (hasName("Jenkinsfile") || hasPath(/(^|\/)\.github\/workflows\/.+\.ya?ml$/i)) {
    labels.push("CI");
    signals.push(hasName("Jenkinsfile") ? "Jenkinsfile" : "GitHub Actions");
  }

  const uniqueLabels = [...new Set(labels)];
  const uniqueSignals = [...new Set(signals)];

  return {
    primary: uniqueLabels.length ? uniqueLabels.join(" + ") : "Unknown",
    labels: uniqueLabels,
    signals: uniqueSignals,
    counts: {
      python: countByExt(files, ".py"),
      javascript: countByExt(files, ".js") + countByExt(files, ".jsx"),
      typescript: countByExt(files, ".ts") + countByExt(files, ".tsx"),
      config: files.filter((file) => /\.(json|ya?ml|toml|ini|cfg)$/i.test(file.filename)).length
    }
  };
}

export function pickImportantFiles(files, limit = 20) {
  const scored = files.map((file) => {
    const name = basename(file.filename).toLowerCase();
    const path = file.filename.toLowerCase();
    let score = 0;

    if (KEEP_BASENAMES.has(name)) score += 80;
    if (/(^|\/)(dockerfile|jenkinsfile)$/i.test(file.filename)) score += 70;
    if (/\.github\/workflows\/.+\.ya?ml$/i.test(path)) score += 65;
    if (/requirements|package|pyproject|pom|gradle|go\.mod|gemfile|pipfile/i.test(path)) score += 55;
    if (/(^|\/)(app|src|lib|server|api)\//i.test(path)) score += 35;
    if (/(^|\/)(test|tests|__tests__)\//i.test(path) || /\.(test|spec)\.[jt]sx?$/i.test(path)) score += 25;
    if (/\.(py|js|ts|jsx|tsx)$/i.test(path)) score += 18;
    if (file.size > 80_000) score -= 15;
    if (file.size > 180_000) score -= 35;

    return { file, score };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.file.filename.localeCompare(b.file.filename))
    .slice(0, limit)
    .map(({ file }) => ({
      filename: file.filename,
      content: trimForPrompt(file.content, 18_000),
      size: file.size
    }));
}

export function createDemoProjectFiles() {
  const files = [
    {
      filename: "package.json",
      content: JSON.stringify(
        {
          scripts: { test: "echo no tests && exit 0" },
          dependencies: { express: "^4.18.2", lodash: "latest" },
          devDependencies: {}
        },
        null,
        2
      )
    },
    {
      filename: "src/server.js",
      content: [
        "var express = require('express');",
        "var app = express();",
        "const api_key = 'sk-demo12345678901234567890';",
        "app.get('/health', async function(req, res) {",
        "  console.log('health check');",
        "  res.send('ok');",
        "});",
        "app.listen(3000);"
      ].join("\n")
    },
    {
      filename: "tests/server.test.js",
      content: "test('demo', () => { expect(true).toBe(true); });\n"
    },
    {
      filename: ".env",
      content: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nPASSWORD=supersecret123\n"
    },
    {
      filename: "Dockerfile",
      content: "FROM node:latest\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD npm start\n"
    },
    {
      filename: "Jenkinsfile",
      content: "pipeline { agent any stages { stage('scan') { steps { sh 'trivy image app || true' } } } }\n"
    }
  ];

  return files.map((file) => ({
    ...file,
    size: new Blob([file.content]).size
  }));
}

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function basename(filename) {
  return normalizePath(filename).split("/").pop() || filename;
}

export function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function countByExt(files, ext) {
  return files.filter((file) => file.filename.toLowerCase().endsWith(ext)).length;
}

function getSkipReason(filename, size, currentTotalBytes) {
  const normalized = normalizePath(filename);

  if (IGNORED_PATH.test(normalized)) return "ignored folder";
  if (!shouldKeepFile(normalized)) return "unsupported file type";
  if (size > MAX_FILE_BYTES) return "file too large";
  if (currentTotalBytes > MAX_TOTAL_BYTES) return "scan size limit reached";

  return "";
}

function shouldKeepFile(filename) {
  const name = basename(filename).toLowerCase();
  const lower = filename.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

  return KEEP_BASENAMES.has(name) || KEEP_EXTENSIONS.has(ext) || /\.github\/workflows\/.+\.ya?ml$/i.test(lower);
}

function trimForPrompt(content, maxChars) {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[truncated: ${content.length - maxChars} chars omitted]`;
}
