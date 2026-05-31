import {
  byBasename,
  isLikelySourceFile,
  isLikelyTestFile,
  lineForPattern,
  makeIssue,
  parseJsonFile,
  splitLines
} from "./common.js";

const TEST_STAGE = "test";

export function analyzeTests(files, project) {
  const issues = [];
  const sourceFiles = files.filter((file) => isLikelySourceFile(file.filename));
  const testFiles = files.filter((file) => isLikelyTestFile(file.filename));

  issues.push(...analyzeCoverageShape(sourceFiles, testFiles, project));
  issues.push(...analyzeTestContent(testFiles));
  issues.push(...analyzeTestScripts(files));

  return issues;
}

function analyzeCoverageShape(sourceFiles, testFiles, project) {
  const issues = [];
  const sourceCount = sourceFiles.length;
  const testCount = testFiles.length;

  if (sourceCount === 0) return issues;

  if (testCount === 0) {
    issues.push(
      makeIssue(
        TEST_STAGE,
        "high",
        "No test files found",
        "project",
        `Detected ${sourceCount} source file${sourceCount === 1 ? "" : "s"} but no test files.`,
        "Add tests under tests/, __tests__, or files named *.test.js / test_*.py, then run them in CI."
      )
    );
    return issues;
  }

  const ratio = testCount / sourceCount;
  if (sourceCount >= 4 && ratio < 0.25) {
    issues.push(
      makeIssue(
        TEST_STAGE,
        "medium",
        "Test coverage shape looks thin",
        "project",
        `Found ${testCount} test file${testCount === 1 ? "" : "s"} for ${sourceCount} source files.`,
        "Add focused tests for core modules until there is at least one meaningful test file per main feature area."
      )
    );
  }

  const labels = new Set(project.labels || []);
  if (labels.has("Python") && !testFiles.some((file) => /(^|\/)tests?\//i.test(file.filename) || /^test_/i.test(file.filename.split("/").pop()))) {
    issues.push(
      makeIssue(
        TEST_STAGE,
        "low",
        "Python tests use nonstandard placement",
        "project",
        "Pytest discovery is easier when tests live in tests/ or use test_*.py naming.",
        "Move Python tests to tests/test_<module>.py or rename them with the test_ prefix."
      )
    );
  }

  return issues;
}

function analyzeTestContent(testFiles) {
  const issues = [];

  testFiles.forEach((file) => {
    const content = file.content;
    const lower = content.toLowerCase();
    const lines = splitLines(content).filter((line) => line.trim() && !line.trim().startsWith("//") && !line.trim().startsWith("#"));

    if (/(assert\s+true\b|expect\(\s*true\s*\)\.to(be|equal)\(\s*true\s*\)|assert\.equal\(\s*1\s*,\s*1\s*\)|assertEquals\(\s*1\s*,\s*1\s*\))/i.test(content)) {
      issues.push(
        makeIssue(
          TEST_STAGE,
          "medium",
          "Test contains a trivially passing assertion",
          `${file.filename}:${lineForPattern(content, /(assert\s+true\b|expect\(\s*true\s*\)\.to(be|equal)\(\s*true\s*\)|assert\.equal\(\s*1\s*,\s*1\s*\)|assertEquals\(\s*1\s*,\s*1\s*\))/i)}`,
          "A test that only proves true is true does not validate application behavior.",
          "Replace it with an assertion against real output, status codes, side effects, or error handling."
        )
      );
    }

    if (/\b(pass|return)\b/i.test(content) && lines.length <= 5 && !hasAssertion(content)) {
      issues.push(
        makeIssue(
          TEST_STAGE,
          "medium",
          "Test body has no meaningful assertion",
          `${file.filename}:1`,
          "A tiny test that returns or passes without checking behavior gives a false pipeline signal.",
          "Assert the expected behavior explicitly, for example:\nassert result.status_code == 200"
        )
      );
    }

    if (!hasAssertion(content) && testLooksExecutable(content)) {
      issues.push(
        makeIssue(
          TEST_STAGE,
          "medium",
          "Test file has no assertions",
          `${file.filename}:1`,
          "The file defines tests but does not appear to check expected outcomes.",
          "Add assertions such as assert, expect(...).toEqual(...), self.assertEqual(...), or pytest.raises(...)."
        )
      );
    }

    if (/(describe|it|test)\.skip\s*\(|xit\s*\(|xdescribe\s*\(|pytest\.mark\.skip|@unittest\.skip/i.test(content)) {
      issues.push(
        makeIssue(
          TEST_STAGE,
          "medium",
          "Skipped tests are committed",
          `${file.filename}:${lineForPattern(content, /(describe|it|test)\.skip\s*\(|xit\s*\(|xdescribe\s*\(|pytest\.mark\.skip|@unittest\.skip/i)}`,
          "Skipped tests hide failing or incomplete behavior from the pipeline.",
          "Unskip the test after fixing the behavior, or delete it if it no longer describes required behavior."
        )
      );
    }

    if (lower.includes("todo") && lines.length < 12) {
      issues.push(
        makeIssue(
          TEST_STAGE,
          "low",
          "Test file still looks like a placeholder",
          `${file.filename}:1`,
          "Short TODO-style test files usually mean the pipeline is not protecting this code yet.",
          "Replace placeholder comments with executable test cases before relying on the pipeline result."
        )
      );
    }
  });

  return issues;
}

function analyzeTestScripts(files) {
  const issues = [];
  const pkg = byBasename(files, "package.json");

  if (pkg) {
    const parsed = parseJsonFile(pkg);
    if (parsed.ok) {
      const script = String(parsed.value.scripts?.test || "");
      if (!script) {
        issues.push(
          makeIssue(
            TEST_STAGE,
            "medium",
            "package.json has no test script",
            pkg.filename,
            "CI systems usually call npm test; without a script, tests may never run.",
            "Add a test script, for example:\n\"scripts\": { \"test\": \"vitest run\" }"
          )
        );
      } else if (/(echo\s+('|")?(no test|no tests|missing)|exit\s+0|true\b)/i.test(script)) {
        issues.push(
          makeIssue(
            TEST_STAGE,
            "high",
            "npm test script always passes",
            `${pkg.filename}:${lineForPattern(pkg.content, /"test"\s*:/i)}`,
            "A placeholder test script can make the pipeline green even when no tests ran.",
            "Replace the placeholder with the real runner, for example:\n\"test\": \"jest --ci\"\n# or\n\"test\": \"vitest run\""
          )
        );
      }
    }
  }

  const requirements = byBasename(files, "requirements.txt");
  const hasPythonTests = files.some((file) => file.filename.toLowerCase().endsWith(".py") && isLikelyTestFile(file.filename));
  if (hasPythonTests && requirements && !/\b(pytest|coverage|unittest2|nose2)\b/i.test(requirements.content)) {
    issues.push(
      makeIssue(
        TEST_STAGE,
        "low",
        "Python test runner is not listed in requirements",
        requirements.filename,
        "CI may fail to run Python tests if the test runner is only installed locally.",
        "Add the runner to requirements.txt or a dev dependency group, for example:\npytest==8.2.2"
      )
    );
  }

  return issues;
}

function hasAssertion(content) {
  return /\b(assert|expect\s*\(|should\.|self\.assert|pytest\.raises|assertThrows|toEqual|toBe|toStrictEqual|assertThat)\b/i.test(content);
}

function testLooksExecutable(content) {
  return /\b(test|it|describe|def\s+test_|class\s+Test|@Test)\b/i.test(content);
}
