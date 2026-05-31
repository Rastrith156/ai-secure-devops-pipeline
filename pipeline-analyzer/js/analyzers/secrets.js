import { byBasename, lineForIndex, lineForPattern, makeIssue, splitLines } from "./common.js";

const SECURITY_STAGE = "security";

const SECRET_PATTERNS = [
  {
    sev: "critical",
    title: "AWS access key detected",
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    fix: "Rotate this AWS key immediately, remove it from git history, and load it from a secrets manager or CI credential store."
  },
  {
    sev: "critical",
    title: "Private key material detected",
    regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    fix: "Remove the private key, rotate the credential, and inject it only through a protected secret store."
  },
  {
    sev: "critical",
    title: "Anthropic API key detected",
    regex: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{20,}\b/g,
    fix: "Revoke the exposed Anthropic key, create a new one, and keep it outside the repository."
  },
  {
    sev: "critical",
    title: "OpenAI-style API key detected",
    regex: /\bsk-[A-Za-z0-9_-]{24,}\b/g,
    fix: "Revoke the exposed key and read it from an environment variable at runtime."
  },
  {
    sev: "high",
    title: "GitHub token detected",
    regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
    fix: "Revoke the GitHub token, remove it from the repository, and use GitHub Actions secrets or Jenkins credentials."
  },
  {
    sev: "high",
    title: "Slack token detected",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    fix: "Rotate the Slack token and store it in the CI/CD platform's protected secret vault."
  },
  {
    sev: "high",
    title: "Google API key detected",
    regex: /\bAIza[0-9A-Za-z_-]{32,}\b/g,
    fix: "Restrict and rotate the Google API key, then load it from protected runtime configuration."
  },
  {
    sev: "high",
    title: "Stripe live secret key detected",
    regex: /\bsk_live_[0-9A-Za-z]{20,}\b/g,
    fix: "Roll the Stripe key in the dashboard and move it to a secret manager or CI credential."
  },
  {
    sev: "high",
    title: "JWT token is hardcoded",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    fix: "Remove the token, rotate the backing credential, and generate JWTs only at runtime."
  }
];

const ASSIGNMENT_SECRET = /\b(api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|private[_-]?key|access[_-]?key)\b\s*[:=]\s*["'`]?([^"'\s`,;#]{8,})/gi;

export function analyzeSecrets(files) {
  const issues = [];

  files.forEach((file) => {
    if (shouldSkipSecretScan(file.filename)) return;
    issues.push(...scanKnownPatterns(file));
    issues.push(...scanAssignments(file));
  });

  issues.push(...scanEnvironmentFiles(files));
  issues.push(...scanGitignore(files));

  return issues;
}

function scanKnownPatterns(file) {
  const issues = [];

  SECRET_PATTERNS.forEach((pattern) => {
    pattern.regex.lastIndex = 0;
    const matches = [...file.content.matchAll(pattern.regex)];
    matches.forEach((match) => {
      if (isLikelyPlaceholder(match[0])) return;
      issues.push(
        makeIssue(
          SECURITY_STAGE,
          pattern.sev,
          pattern.title,
          `${file.filename}:${lineForIndex(file.content, match.index)}`,
          "A credential-like value is committed in source control. Treat it as exposed.",
          pattern.fix
        )
      );
    });
  });

  return issues;
}

function scanAssignments(file) {
  const issues = [];
  ASSIGNMENT_SECRET.lastIndex = 0;

  for (const match of file.content.matchAll(ASSIGNMENT_SECRET)) {
    const key = match[1];
    const value = match[2];
    if (isLikelyPlaceholder(value) || isRuntimeReference(value)) continue;

    issues.push(
      makeIssue(
        SECURITY_STAGE,
        isDangerousSecretName(key) ? "high" : "medium",
        "Hardcoded secret-like assignment",
        `${file.filename}:${lineForIndex(file.content, match.index)}`,
        `The variable name "${key}" looks sensitive and has a literal value.`,
        `Move ${key} to an environment variable or secret store, for example:\n${key}=process.env.${toEnvName(key)}`
      )
    );
  }

  return issues;
}

function scanEnvironmentFiles(files) {
  const issues = [];
  const envFiles = files.filter((file) => isCommittedEnvFile(file.filename));

  envFiles.forEach((file) => {
    issues.push(
      makeIssue(
        SECURITY_STAGE,
        "high",
        ".env file is committed",
        `${file.filename}:${lineForPattern(file.content, /\S/)}`,
        "Environment files often contain credentials and should not be part of student submissions or production repositories.",
        "Remove .env from git, create .env.example with safe placeholders, and add .env* to .gitignore while allowing .env.example."
      )
    );
  });

  return issues;
}

function scanGitignore(files) {
  const issues = [];
  const gitignore = byBasename(files, ".gitignore");

  if (!gitignore) {
    issues.push(
      makeIssue(
        SECURITY_STAGE,
        "medium",
        "Repository has no .gitignore",
        "project",
        "Without .gitignore, credentials, virtual environments, dependencies, and build outputs are easy to commit accidentally.",
        "Add a .gitignore with entries such as:\n.env*\n!.env.example\nnode_modules/\nvenv/\n__pycache__/\ndist/\nbuild/"
      )
    );
    return issues;
  }

  const normalized = splitLines(gitignore.content)
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter(Boolean);
  const ignoresEnv = normalized.some((line) => /^\.env(\*|$)|^\*\.env$/i.test(line));

  if (!ignoresEnv) {
    issues.push(
      makeIssue(
        SECURITY_STAGE,
        "medium",
        ".gitignore does not protect .env files",
        gitignore.filename,
        "A .gitignore exists, but it does not block local environment secrets.",
        "Add these lines:\n.env*\n!.env.example"
      )
    );
  }

  return issues;
}

function isCommittedEnvFile(filename) {
  const lower = filename.toLowerCase();
  const name = lower.split("/").pop();
  if (!name || !name.startsWith(".env")) return false;
  return !/(\.example|\.sample|\.template|\.dist)$/.test(name);
}

function shouldSkipSecretScan(filename) {
  return /\.(lock|min\.js|map)$/i.test(filename) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(filename);
}

function isLikelyPlaceholder(value) {
  const lower = String(value || "").toLowerCase();
  return (
    lower.length < 8 ||
    /^(x+|_+|-+|\*+)$/.test(lower) ||
    /(example|sample|dummy|placeholder|changeme|change_me|replace_me|your_|your-|test|fake|demo|not-a-real|redacted)/i.test(lower)
  );
}

function isRuntimeReference(value) {
  return /(\$\{|process\.env|os\.environ|getenv|secrets\.|vault\.|env\.|config\.)/i.test(value);
}

function isDangerousSecretName(key) {
  return /(password|passwd|pwd|private|secret|token|api[_-]?key|access[_-]?key)/i.test(key);
}

function toEnvName(key) {
  return String(key || "SECRET")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}
