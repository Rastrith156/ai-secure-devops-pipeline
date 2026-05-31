const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT_MS = 45_000;

const STAGE_ALIASES = {
  install: "install",
  dependency: "install",
  dependencies: "install",
  deps: "install",
  test: "test",
  tests: "test",
  security: "security",
  secrets: "security",
  secret: "security",
  quality: "quality",
  code_quality: "quality",
  docker: "docker",
  ci: "docker",
  report: "report"
};

export async function analyzeWithClaude({ apiKey, model, files, project, signal, onStatus = () => {} }) {
  if (!apiKey) return [];

  onStatus("Asking Claude for deeper findings...");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const effectiveSignal = signal ? combineSignals(signal, controller.signal) : controller.signal;

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: effectiveSignal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-5",
        max_tokens: 2400,
        temperature: 0,
        system:
          "You are a DevSecOps static review engine for student projects. Return JSON only. Do not include markdown fences, prose, or secrets from the input.",
        messages: [
          {
            role: "user",
            content: buildPrompt(files, project)
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await safeReadError(response);
      throw new Error(`Claude API ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    return normalizeClaudeIssues(parseJsonIssues(text));
  } finally {
    window.clearTimeout(timeout);
  }
}

function combineSignals(...signals) {
  const liveSignals = signals.filter(Boolean);
  if (liveSignals.length === 1) return liveSignals[0];
  if (AbortSignal.any) return AbortSignal.any(liveSignals);

  const controller = new AbortController();
  const abort = () => controller.abort();

  liveSignals.forEach((signal) => {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });

  return controller.signal;
}

function buildPrompt(files, project) {
  const fileBlocks = files
    .map(
      (file) =>
        `<file path="${file.filename}">\n${file.content.replaceAll("</file>", "<\\/file>")}\n</file>`
    )
    .join("\n\n");

  return [
    "Analyze this uploaded student project for DevOps, security, dependency, testing, code quality, Docker, and CI issues.",
    "Return a compact JSON object with this exact shape:",
    '{"issues":[{"sev":"critical|high|medium|low","title":"short title","file":"path:line","desc":"why this matters","fix":"exact code or command fix","stage":"install|test|security|quality|docker"}]}',
    "Rules:",
    "- Only report concrete issues supported by the files.",
    "- Do not repeat obvious static-rule findings unless you add a better fix.",
    "- Do not quote any secret values.",
    "- Keep fixes copyable and specific.",
    "",
    `Detected project: ${project.primary || "Unknown"}`,
    `Signals: ${(project.signals || []).join(", ") || "none"}`,
    "",
    fileBlocks
  ].join("\n");
}

function parseJsonIssues(text) {
  const trimmed = text.trim();
  const candidate = extractJson(trimmed);
  const parsed = JSON.parse(candidate);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.issues)) return parsed.issues;
  return [];
}

function extractJson(text) {
  if (text.startsWith("{") || text.startsWith("[")) return text;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");
  const start = firstArray >= 0 && (firstArray < firstObject || firstObject < 0) ? firstArray : firstObject;
  const end = text.lastIndexOf(text[start] === "[" ? "]" : "}");

  if (start >= 0 && end > start) return text.slice(start, end + 1);
  throw new Error("Claude did not return JSON.");
}

function normalizeClaudeIssues(rawIssues) {
  return rawIssues
    .map((issue) => ({
      sev: normalizeSeverity(issue.sev || issue.severity),
      title: String(issue.title || "AI finding").slice(0, 120),
      file: String(issue.file || "project"),
      desc: String(issue.desc || issue.description || "Claude found a project risk."),
      fix: String(issue.fix || "Review and fix this issue before merging."),
      stage: normalizeStage(issue.stage || issue.category || issue.type || issue.title),
      source: "ai",
      ai: true
    }))
    .filter((issue) => issue.title && issue.desc && issue.fix);
}

function normalizeSeverity(value) {
  const sev = String(value || "").toLowerCase();
  return ["critical", "high", "medium", "low"].includes(sev) ? sev : "medium";
}

function normalizeStage(value) {
  const raw = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (STAGE_ALIASES[raw]) return STAGE_ALIASES[raw];
  if (/depend|install|package|version/.test(raw)) return "install";
  if (/test|coverage|assert/.test(raw)) return "test";
  if (/secret|token|key|security|vulnerab/.test(raw)) return "security";
  if (/quality|lint|complex|error|type/.test(raw)) return "quality";
  if (/docker|container|jenkins|ci|workflow|trivy/.test(raw)) return "docker";
  return "quality";
}

async function safeReadError(response) {
  try {
    const data = await response.json();
    return data.error?.message || JSON.stringify(data).slice(0, 300);
  } catch {
    return (await response.text()).slice(0, 300);
  }
}
