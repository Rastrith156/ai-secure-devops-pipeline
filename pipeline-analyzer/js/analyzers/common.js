export const SEVERITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

export function makeIssue(stage, sev, title, file, desc, fix, extra = {}) {
  return {
    stage,
    sev,
    title,
    file: file || "project",
    desc,
    fix,
    source: "static",
    ...extra
  };
}

export function byBasename(files, name) {
  const expected = name.toLowerCase();
  return files.find((file) => basename(file.filename).toLowerCase() === expected);
}

export function findFiles(files, predicate) {
  return files.filter((file) => predicate(file.filename.toLowerCase(), file));
}

export function basename(filename) {
  return String(filename || "").replace(/\\/g, "/").split("/").pop() || "";
}

export function extname(filename) {
  const name = basename(filename).toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

export function splitLines(content) {
  return String(content || "").split(/\r?\n/);
}

export function lineForIndex(content, index) {
  return String(content || "").slice(0, Math.max(index, 0)).split(/\r?\n/).length;
}

export function lineForPattern(content, pattern) {
  const regex = cloneRegex(pattern);
  const match = regex.exec(content);
  return match ? lineForIndex(content, match.index) : 1;
}

export function firstNonEmptyLine(content) {
  const lines = splitLines(content);
  const index = lines.findIndex((line) => line.trim());
  return index >= 0 ? index + 1 : 1;
}

export function parseJsonFile(file) {
  try {
    return { ok: true, value: JSON.parse(file.content) };
  } catch (error) {
    return { ok: false, error };
  }
}

export function isLikelyTestFile(filename) {
  const lower = filename.toLowerCase();
  const name = basename(lower);
  return (
    /(^|\/)(test|tests|__tests__|spec)\//i.test(lower) ||
    /^test[_-]/i.test(name) ||
    /[_-]test\./i.test(name) ||
    /\.(test|spec)\.[jt]sx?$/i.test(name) ||
    /test_.*\.py$/i.test(name)
  );
}

export function isLikelySourceFile(filename) {
  const lower = filename.toLowerCase();
  if (isLikelyTestFile(lower)) return false;
  if (/(^|\/)(node_modules|dist|build|coverage|vendor)\//i.test(lower)) return false;
  return /\.(py|js|jsx|ts|tsx|java|go|rb)$/i.test(lower);
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

export function hasAnyFile(files, predicate) {
  return files.some((file) => predicate(file.filename.toLowerCase(), file));
}

export function severitySort(a, b) {
  return (SEVERITY_RANK[a.sev] ?? 9) - (SEVERITY_RANK[b.sev] ?? 9) || a.title.localeCompare(b.title);
}

export function safeSnippet(value, max = 160) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function cloneRegex(pattern) {
  return new RegExp(pattern.source, pattern.flags.replace("g", ""));
}
