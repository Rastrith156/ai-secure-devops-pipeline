import { analyzeWithClaude } from "./ai.js";
import { analyzeDependencies } from "./analyzers/deps.js";
import { analyzeDockerAndCi } from "./analyzers/docker.js";
import { analyzeQuality } from "./analyzers/quality.js";
import { analyzeSecrets } from "./analyzers/secrets.js";
import { analyzeTests } from "./analyzers/tests.js";
import { severitySort } from "./analyzers/common.js";
import { buildReportText, calculateScore, countBySeverity, renderReport } from "./report.js";
import { createDemoProjectFiles, detectProjectType, extractZip, formatBytes, pickImportantFiles } from "./uploader.js";

const STAGES = [
  { id: "install", label: "Install", icon: "package-check", sub: "Dependency reproducibility" },
  { id: "test", label: "Test", icon: "flask-conical", sub: "Test presence and quality" },
  { id: "security", label: "Security", icon: "shield-alert", sub: "Secrets and risky exposure" },
  { id: "quality", label: "Quality", icon: "scan-text", sub: "Code maintainability" },
  { id: "docker", label: "Docker", icon: "container", sub: "Container and CI safety" },
  { id: "report", label: "Report", icon: "file-check-2", sub: "Prioritized fixes and score" }
];

const ANALYZERS = [
  { stage: "install", run: analyzeDependencies },
  { stage: "test", run: analyzeTests },
  { stage: "security", run: analyzeSecrets },
  { stage: "quality", run: analyzeQuality },
  { stage: "docker", run: analyzeDockerAndCi }
];

const state = {
  files: [],
  skipped: [],
  project: detectProjectType([]),
  issues: [],
  stageIssues: emptyStageIssues(),
  reportText: "",
  running: false
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindElements();
  bindEvents();
  renderStages();
  renderSummary();
  refreshIcons();
}

function bindElements() {
  [
    "dropZone",
    "zipInput",
    "browseBtn",
    "demoBtn",
    "analyzeBtn",
    "clearBtn",
    "apiKeyInput",
    "modelInput",
    "progressBar",
    "statusText",
    "projectType",
    "projectSignals",
    "fileMetric",
    "skipMetric",
    "issueMetric",
    "severityMetric",
    "fileList",
    "fileCountBadge",
    "stageGrid",
    "runtimeBadge",
    "reportBody",
    "scorePill",
    "scoreValue",
    "scoreLabel",
    "copyReportBtn",
    "printBtn",
    "toast"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.browseBtn.addEventListener("click", () => els.zipInput.click());
  els.zipInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) handleZip(file);
  });

  els.dropZone.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    els.zipInput.click();
  });
  els.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.zipInput.click();
    }
  });
  els.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropZone.classList.add("is-dragover");
  });
  els.dropZone.addEventListener("dragleave", () => {
    els.dropZone.classList.remove("is-dragover");
  });
  els.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("is-dragover");
    const file = [...event.dataTransfer.files].find((item) => /\.zip$/i.test(item.name));
    if (file) handleZip(file);
    else showToast("Drop a .zip file.");
  });

  els.demoBtn.addEventListener("click", loadDemo);
  els.analyzeBtn.addEventListener("click", runAnalysis);
  els.clearBtn.addEventListener("click", clearAll);
  els.copyReportBtn.addEventListener("click", copyReport);
  els.printBtn.addEventListener("click", () => window.print());

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-fix]");
    if (!button) return;
    copyFix(button.dataset.copyFix);
  });
}

async function handleZip(file) {
  if (!/\.zip$/i.test(file.name)) {
    showToast("Please choose a .zip file.");
    return;
  }

  setBusy(true);
  resetResults();
  setStatus(`Extracting ${file.name}...`);
  setProgress(0);

  try {
    const result = await extractZip(file, {
      onProgress(progress) {
        setProgress(Math.round(progress * 35));
      }
    });

    state.files = result.files;
    state.skipped = result.skipped;
    state.project = result.project;
    state.issues = [];
    state.stageIssues = emptyStageIssues();

    renderFiles();
    renderSummary();
    renderStages();
    setStatus(`Loaded ${result.files.length} analyzable files from ${file.name}.`);
    els.analyzeBtn.disabled = state.files.length === 0;
    els.clearBtn.disabled = false;

    if (state.files.length) {
      setBusy(false);
      await runAnalysis();
    }
  } catch (error) {
    setStatus("ZIP extraction failed.");
    showToast(error.message || "Could not read ZIP.");
  } finally {
    setBusy(false);
    setProgress(0);
    els.zipInput.value = "";
  }
}

function loadDemo() {
  state.files = createDemoProjectFiles();
  state.skipped = [];
  state.project = detectProjectType(state.files);
  state.issues = [];
  state.stageIssues = emptyStageIssues();

  renderFiles();
  renderSummary();
  renderStages();
  setStatus("Demo project loaded.");
  els.analyzeBtn.disabled = false;
  els.clearBtn.disabled = false;
  runAnalysis();
}

async function runAnalysis() {
  if (!state.files.length || state.running) return;

  const started = performance.now();
  setBusy(true);
  setStatus("Running static pipeline checks...");
  setProgress(42);
  els.runtimeBadge.textContent = "Running";

  state.stageIssues = emptyStageIssues();
  renderStages(new Set(ANALYZERS.map((item) => item.stage)));

  try {
    const results = await Promise.all(
      ANALYZERS.map(async ({ stage, run }) => ({
        stage,
        issues: await Promise.resolve(run(state.files, state.project))
      }))
    );

    results.forEach(({ stage, issues }) => {
      state.stageIssues[stage] = issues;
    });

    let issues = results.flatMap((result) => result.issues);
    setProgress(72);

    const apiKey = els.apiKeyInput.value.trim();
    if (apiKey) {
      try {
        const aiIssues = await analyzeWithClaude({
          apiKey,
          model: els.modelInput.value.trim(),
          files: pickImportantFiles(state.files, 20),
          project: state.project,
          onStatus: setStatus
        });
        issues = mergeIssues(issues, aiIssues);
      } catch (error) {
        showToast(error.message || "Claude analysis failed.");
      }
    }

    state.issues = assignIds(mergeIssues([], issues));
    state.stageIssues = groupIssuesByStage(state.issues);
    state.stageIssues.report = [...state.issues].sort(severitySort);
    state.reportText = buildReportText(state.issues, state.project);

    renderStages();
    renderReport(els.reportBody, state.issues);
    renderSummary();
    updateScorePill();

    els.copyReportBtn.disabled = false;
    els.printBtn.disabled = false;
    const elapsed = Math.max(1, Math.round(performance.now() - started));
    els.runtimeBadge.textContent = `${elapsed} ms`;
    setStatus(`Analysis complete in ${elapsed} ms.`);
    setProgress(100);
    window.setTimeout(() => setProgress(0), 450);
  } finally {
    setBusy(false);
  }
}

function renderStages(runningStages = new Set()) {
  els.stageGrid.innerHTML = STAGES.map((stage) => renderStageCard(stage, runningStages.has(stage.id))).join("");
  refreshIcons();
}

function renderStageCard(stage, isRunning) {
  const issues = state.stageIssues[stage.id] || [];
  const status = isRunning ? "running" : getStageStatus(issues);
  const shouldOpen = !isRunning && issues.length > 0;

  return `
    <details class="stage-card ${isRunning ? "is-active" : ""}" ${shouldOpen ? "open" : ""}>
      <summary>
        <span class="stage-icon" aria-hidden="true"><i data-lucide="${stage.icon}"></i></span>
        <span class="stage-title">
          <strong>${escapeHtml(stage.label)}</strong>
          <span>${escapeHtml(stage.sub)}</span>
        </span>
        <span class="status-badge status-${status}">${getStatusLabel(status, issues.length)}</span>
      </summary>
      <div class="stage-issues">
        ${issues.length ? issues.map(renderIssue).join("") : '<p class="empty-state">No issues in this stage.</p>'}
      </div>
    </details>
  `;
}

function renderIssue(issue) {
  return `
    <article class="issue-row" data-issue-id="${escapeHtml(issue.id || "")}">
      <div class="issue-head">
        <div>
          <p class="issue-title">${escapeHtml(issue.title)}</p>
          <span class="issue-file">${escapeHtml(issue.file || "project")}</span>
        </div>
        <div>
          ${issue.ai ? '<span class="ai-badge">AI</span>' : ""}
          <span class="sev sev-${escapeHtml(issue.sev)}">${escapeHtml(issue.sev)}</span>
        </div>
      </div>
      <p class="issue-desc">${escapeHtml(issue.desc)}</p>
      <pre class="fix-code">${escapeHtml(issue.fix)}</pre>
      <div class="copy-line">
        <button class="copy-button" type="button" data-copy-fix="${escapeHtml(issue.id || "")}">
          <i data-lucide="copy"></i>
          Copy Fix
        </button>
      </div>
    </article>
  `;
}

function renderFiles() {
  els.fileCountBadge.textContent = String(state.files.length);

  if (!state.files.length) {
    els.fileList.innerHTML = '<p class="empty-state">No ZIP loaded.</p>';
    return;
  }

  const visible = state.files.slice(0, 160);
  const remainder = state.files.length - visible.length;

  els.fileList.innerHTML = `
    ${visible
      .map(
        (file) => `
          <div class="file-row" title="${escapeHtml(file.filename)}">
            <i data-lucide="${getFileIcon(file.filename)}" aria-hidden="true"></i>
            <code>${escapeHtml(file.filename)}</code>
            <span class="file-size">${formatBytes(file.size)}</span>
          </div>
        `
      )
      .join("")}
    ${remainder > 0 ? `<p class="empty-state">${remainder} more files kept for analysis.</p>` : ""}
  `;

  refreshIcons();
}

function renderSummary() {
  const score = calculateScore(state.issues);
  const counts = countBySeverity(state.issues);
  const signalText = state.project.signals?.length ? state.project.signals.slice(0, 4).join(", ") : "No stack signals yet";

  els.projectType.textContent = state.project.primary || "No project";
  els.projectSignals.textContent = signalText;
  els.fileMetric.textContent = `${state.files.length} file${state.files.length === 1 ? "" : "s"}`;
  els.skipMetric.textContent = `${state.skipped.length} skipped`;
  els.issueMetric.textContent = `${state.issues.length} issue${state.issues.length === 1 ? "" : "s"}`;
  els.severityMetric.textContent = state.issues.length
    ? `C ${counts.critical} / H ${counts.high} / M ${counts.medium} / L ${counts.low}`
    : "No scan yet";

  if (state.issues.length) {
    els.scoreValue.textContent = String(score.score);
    els.scoreLabel.textContent = score.label;
  }
}

function updateScorePill() {
  const score = calculateScore(state.issues);
  els.scorePill.hidden = false;
  els.scoreValue.textContent = String(score.score);
  els.scoreLabel.textContent = score.label;
  els.scorePill.style.borderColor = score.color;
}

function resetResults() {
  state.files = [];
  state.skipped = [];
  state.project = detectProjectType([]);
  state.issues = [];
  state.stageIssues = emptyStageIssues();
  state.reportText = "";
  els.reportBody.innerHTML = '<p class="empty-state">The final report appears after analysis.</p>';
  els.copyReportBtn.disabled = true;
  els.printBtn.disabled = true;
  els.scorePill.hidden = true;
  renderFiles();
  renderSummary();
  renderStages();
}

function clearAll() {
  resetResults();
  els.analyzeBtn.disabled = true;
  els.clearBtn.disabled = true;
  els.runtimeBadge.textContent = "Idle";
  setStatus("Ready for a ZIP scan.");
  setProgress(0);
}

function emptyStageIssues() {
  return STAGES.reduce((acc, stage) => {
    acc[stage.id] = [];
    return acc;
  }, {});
}

function groupIssuesByStage(issues) {
  const grouped = emptyStageIssues();
  issues.forEach((issue) => {
    const stage = grouped[issue.stage] ? issue.stage : "quality";
    grouped[stage].push(issue);
  });

  Object.keys(grouped).forEach((stage) => {
    grouped[stage].sort(severitySort);
  });

  return grouped;
}

function mergeIssues(staticIssues, nextIssues) {
  const merged = [];

  [...staticIssues, ...nextIssues].forEach((issue) => {
    const normalized = normalizeIssue(issue);
    if (!merged.some((existing) => isDuplicateIssue(existing, normalized))) {
      merged.push(normalized);
    }
  });

  return merged;
}

function normalizeIssue(issue) {
  const sev = ["critical", "high", "medium", "low"].includes(issue.sev) ? issue.sev : "medium";
  const stage = STAGES.some((item) => item.id === issue.stage) ? issue.stage : inferStage(issue);

  return {
    sev,
    stage,
    title: String(issue.title || "Pipeline issue").trim(),
    file: String(issue.file || "project").trim(),
    desc: String(issue.desc || "The pipeline found a risk in this project.").trim(),
    fix: String(issue.fix || "Review and fix this issue.").trim(),
    source: issue.source || "static",
    ai: Boolean(issue.ai || issue.source === "ai")
  };
}

function assignIds(issues) {
  return issues.sort(severitySort).map((issue, index) => ({
    ...issue,
    id: `issue-${index + 1}`
  }));
}

function isDuplicateIssue(a, b) {
  if (a.stage !== b.stage) return false;
  if (cleanFile(a.file) !== cleanFile(b.file)) return false;

  const aTitle = cleanText(a.title);
  const bTitle = cleanText(b.title);
  if (aTitle === bTitle) return true;

  const aWords = new Set(aTitle.split(" ").filter((word) => word.length > 3));
  const bWords = bTitle.split(" ").filter((word) => word.length > 3);
  if (!aWords.size || !bWords.length) return false;
  const overlap = bWords.filter((word) => aWords.has(word)).length;
  return overlap / Math.max(aWords.size, bWords.length) >= 0.65;
}

function inferStage(issue) {
  const text = `${issue.title || ""} ${issue.desc || ""}`.toLowerCase();
  if (/depend|package|install|version|lockfile/.test(text)) return "install";
  if (/test|coverage|assert|skip/.test(text)) return "test";
  if (/secret|token|password|key|credential|security/.test(text)) return "security";
  if (/docker|container|jenkins|ci|trivy|workflow/.test(text)) return "docker";
  return "quality";
}

function getStageStatus(issues) {
  if (!issues.length) return "pass";
  if (issues.some((issue) => issue.sev === "critical" || issue.sev === "high")) return "fail";
  return "warning";
}

function getStatusLabel(status, issueCount) {
  if (status === "running") return "Running";
  if (status === "pass") return "Pass";
  if (status === "fail") return `Fail ${issueCount}`;
  if (status === "warning") return `Warn ${issueCount}`;
  return "Idle";
}

function getFileIcon(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "braces";
  if (/\.(yml|yaml)$/.test(lower)) return "workflow";
  if (lower.endsWith(".py")) return "file-code-2";
  if (/\.(js|jsx|ts|tsx)$/.test(lower)) return "scroll-text";
  if (lower.includes("dockerfile")) return "container";
  if (lower.includes("jenkinsfile")) return "route";
  if (lower.includes(".env")) return "key-round";
  return "file";
}

async function copyFix(id) {
  const issue = state.issues.find((item) => item.id === id);
  if (!issue) return;
  await copyText(issue.fix);
  showToast("Fix copied.");
}

async function copyReport() {
  if (!state.reportText) return;
  await copyText(state.reportText);
  showToast("Report copied.");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function setBusy(isBusy) {
  state.running = isBusy;
  els.analyzeBtn.disabled = isBusy || !state.files.length;
  els.demoBtn.disabled = isBusy;
  els.browseBtn.disabled = isBusy;
  els.clearBtn.disabled = isBusy ? true : !state.files.length;
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function setProgress(value) {
  els.progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}

function cleanFile(file) {
  return String(file || "project").replace(/:\d+$/, "").toLowerCase();
}

function cleanText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function refreshIcons() {
  window.lucide?.createIcons();
}
