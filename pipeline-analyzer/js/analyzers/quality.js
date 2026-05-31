import { basename, byBasename, findFiles, lineForIndex, lineForPattern, makeIssue, splitLines } from "./common.js";

const QUALITY_STAGE = "quality";

export function analyzeQuality(files, project) {
  const issues = [];

  findFiles(files, (name) => name.endsWith(".py")).forEach((file) => {
    issues.push(...analyzePythonFile(file));
  });

  findFiles(files, (name) => /\.(js|jsx|ts|tsx)$/i.test(name)).forEach((file) => {
    issues.push(...analyzeJavaScriptFile(file));
  });

  issues.push(...analyzeProjectQualityConfig(files, project));

  return issues;
}

function analyzePythonFile(file) {
  const issues = [];
  const content = file.content;

  if (/^\s*except\s*:\s*(#.*)?$/m.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "high",
        "Python bare except hides failures",
        `${file.filename}:${lineForPattern(content, /^\s*except\s*:\s*(#.*)?$/m)}`,
        "Bare except catches system-exiting exceptions and makes pipeline failures hard to diagnose.",
        "Catch a specific exception and log or re-raise it, for example:\nexcept ValueError as error:\n    raise RuntimeError('invalid input') from error"
      )
    );
  }

  if (/^\s*except\s+(Exception|BaseException)\s*(as\s+\w+)?\s*:/m.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "medium",
        "Python catches an overly broad exception",
        `${file.filename}:${lineForPattern(content, /^\s*except\s+(Exception|BaseException)\s*(as\s+\w+)?\s*:/m)}`,
        "Broad exception handling can hide broken tests, security scan failures, and real runtime errors.",
        "Catch the narrow exception type you expect, then handle or re-raise it deliberately."
      )
    );
  }

  if (/\b(eval|exec)\s*\(/.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "high",
        "Python dynamic code execution is used",
        `${file.filename}:${lineForPattern(content, /\b(eval|exec)\s*\(/)}`,
        "eval and exec make static analysis weak and can execute attacker-controlled input.",
        "Replace eval/exec with a safe parser, mapping table, or explicit function call."
      )
    );
  }

  if (/subprocess\.[\w.]+\([\s\S]{0,220}shell\s*=\s*True/.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "high",
        "subprocess runs with shell=True",
        `${file.filename}:${lineForPattern(content, /subprocess\.[\w.]+\(/)}`,
        "shell=True can turn string input into command injection risk.",
        "Pass commands as an argument array and leave shell=False, for example:\nsubprocess.run(['python', '-m', 'pytest'], check=True)"
      )
    );
  }

  if (/^\s*(DEBUG|debug)\s*=\s*True\b/m.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "medium",
        "Debug mode is enabled in code",
        `${file.filename}:${lineForPattern(content, /^\s*(DEBUG|debug)\s*=\s*True\b/m)}`,
        "Debug mode can expose stack traces, environment values, and internal paths.",
        "Read debug mode from environment and default it off:\nDEBUG = os.getenv('DEBUG') == '1'"
      )
    );
  }

  const printLines = [...content.matchAll(/(^|[^\w.])print\s*\(/gm)];
  if (printLines.length >= 4) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "low",
        "Python file relies heavily on print()",
        `${file.filename}:${lineForIndex(content, printLines[0].index)}`,
        `Found ${printLines.length} print calls. Logs are easier to filter and capture in CI.`,
        "Use the logging module with levels, for example:\nlogger = logging.getLogger(__name__)\nlogger.info('message')"
      )
    );
  }

  const missingHintLines = findPythonFunctionsWithoutHints(content);
  if (missingHintLines.length >= 2) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "low",
        "Python functions lack return type hints",
        `${file.filename}:${missingHintLines[0]}`,
        `Found ${missingHintLines.length} public functions without return type hints.`,
        "Add return types to public functions, for example:\ndef build_report(files: list[ProjectFile]) -> Report:"
      )
    );
  }

  if (/def\s+\w+\([^)]*=\s*(\[\]|\{\}|set\(\))/m.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "medium",
        "Python function uses a mutable default argument",
        `${file.filename}:${lineForPattern(content, /def\s+\w+\([^)]*=\s*(\[\]|\{\}|set\(\))/m)}`,
        "Mutable defaults are shared between calls and can create order-dependent test failures.",
        "Use None as the default and create the mutable value inside the function."
      )
    );
  }

  return issues;
}

function analyzeJavaScriptFile(file) {
  const issues = [];
  const content = file.content;

  if (/(^|[^\w$])var\s+[A-Za-z_$]/m.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "low",
        "JavaScript uses var",
        `${file.filename}:${lineForPattern(content, /(^|[^\w$])var\s+[A-Za-z_$]/m)}`,
        "var is function-scoped and can make bugs harder to see during reviews.",
        "Use const by default and let when reassignment is required."
      )
    );
  }

  const consoleMatches = [...content.matchAll(/\bconsole\.(log|debug|trace)\s*\(/g)];
  if (consoleMatches.length > 0) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        consoleMatches.length >= 4 ? "medium" : "low",
        "Console logging is committed",
        `${file.filename}:${lineForIndex(content, consoleMatches[0].index)}`,
        `Found ${consoleMatches.length} console call${consoleMatches.length === 1 ? "" : "s"} that may leak noisy output in CI or production.`,
        "Replace console.log/debug/trace with a project logger or remove temporary debug output."
      )
    );
  }

  if (/\b(eval|Function)\s*\(/.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "high",
        "JavaScript dynamic code execution is used",
        `${file.filename}:${lineForPattern(content, /\b(eval|Function)\s*\(/)}`,
        "Dynamic execution blocks reliable static analysis and can run attacker-controlled input.",
        "Replace eval/new Function with JSON parsing, a whitelist map, or explicit callbacks."
      )
    );
  }

  if (/catch\s*\([^)]*\)\s*{\s*}/m.test(content) || /catch\s*{\s*}/m.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "medium",
        "JavaScript has an empty catch block",
        `${file.filename}:${lineForPattern(content, /catch\s*(\([^)]*\))?\s*{\s*}/m)}`,
        "Empty catch blocks hide errors from tests and monitoring.",
        "Handle the error, log it, or rethrow it with context."
      )
    );
  }

  if (/[^=!]==[^=]|!=[^=]/.test(stripComments(content))) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "low",
        "JavaScript uses loose equality",
        `${file.filename}:${lineForPattern(content, /[^=!]==[^=]|!=[^=]/)}`,
        "Loose equality coerces types and can create surprising test failures.",
        "Use === and !== unless coercion is explicitly required and documented."
      )
    );
  }

  if (/\basync\b[\s\S]{0,1200}\bawait\b/.test(content) && !/\btry\s*{/.test(content) && !/\.catch\s*\(/.test(content)) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "medium",
        "Async JavaScript lacks visible error handling",
        `${file.filename}:${lineForPattern(content, /\basync\b/)}`,
        "Awaited operations can reject and fail silently depending on the caller.",
        "Wrap awaited operations in try/catch or return the promise to a caller that handles rejection."
      )
    );
  }

  const anyMatches = [...content.matchAll(/:\s*any\b/g)];
  if (/\.(ts|tsx)$/i.test(file.filename) && anyMatches.length >= 4) {
    issues.push(
      makeIssue(
        QUALITY_STAGE,
        "low",
        "TypeScript uses many any annotations",
        `${file.filename}:${lineForIndex(content, anyMatches[0].index)}`,
        `Found ${anyMatches.length} any annotations. They reduce the value of TypeScript in CI.`,
        "Replace any with specific interfaces, unknown plus narrowing, or generated types."
      )
    );
  }

  return issues;
}

function analyzeProjectQualityConfig(files, project) {
  const issues = [];
  const labels = new Set(project.labels || []);

  if (labels.has("Node")) {
    const hasEslint = files.some((file) => /(^|\/)(eslint\.config\.(js|mjs|cjs)|\.eslintrc(\..*)?)$/i.test(file.filename));
    if (!hasEslint) {
      issues.push(
        makeIssue(
          QUALITY_STAGE,
          "low",
          "Node project has no ESLint config",
          "project",
          "A linter catches simple quality issues before code reaches the pipeline report.",
          "Add ESLint and commit a config, for example:\nnpm init @eslint/config@latest"
        )
      );
    }
  }

  if (labels.has("Python")) {
    const hasPyLintConfig =
      byBasename(files, "pyproject.toml") ||
      byBasename(files, "ruff.toml") ||
      byBasename(files, ".flake8") ||
      byBasename(files, "setup.cfg");

    if (!hasPyLintConfig) {
      issues.push(
        makeIssue(
          QUALITY_STAGE,
          "low",
          "Python project has no lint configuration",
          "project",
          "A committed linter config helps make quality checks repeatable across student machines and CI.",
          "Add Ruff configuration to pyproject.toml, then run:\nruff check ."
        )
      );
    }
  }

  return issues;
}

function findPythonFunctionsWithoutHints(content) {
  const lines = splitLines(content);
  const result = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("def ")) return;
    if (/^def\s+_/.test(trimmed)) return;
    if (/->/.test(trimmed)) return;
    result.push(index + 1);
  });

  return result;
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
