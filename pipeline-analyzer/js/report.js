import { severitySort } from "./analyzers/common.js";

const SCORE_DEDUCTIONS = {
  critical: 15,
  high: 8,
  medium: 4,
  low: 1
};

const STAGE_LABELS = {
  install: "Install",
  test: "Test",
  security: "Security",
  quality: "Quality",
  docker: "Docker",
  report: "Report"
};

export function calculateScore(issues) {
  const counts = countBySeverity(issues);
  const totalDeduction = Object.entries(counts).reduce((sum, [sev, count]) => sum + (SCORE_DEDUCTIONS[sev] || 0) * count, 0);
  const score = Math.max(0, 100 - totalDeduction);
  const label = getScoreLabel(score);

  return {
    score,
    label,
    color: getScoreColor(score),
    counts
  };
}

export function renderReport(container, issues) {
  if (!issues.length) {
    container.innerHTML = `
      <div class="report-body-grid">
        ${renderScoreSummary(calculateScore([]))}
        <p class="empty-state">No issues found. The project passed the static pipeline checks.</p>
      </div>
    `;
    refreshIcons();
    return;
  }

  const sorted = [...issues].sort(severitySort);
  const score = calculateScore(sorted);

  container.innerHTML = `
    <div class="report-body-grid">
      ${renderScoreSummary(score)}
      <div class="report-list">
        ${sorted.map(renderReportIssue).join("")}
      </div>
    </div>
  `;

  refreshIcons();
}

export function buildReportText(issues, project) {
  const sorted = [...issues].sort(severitySort);
  const score = calculateScore(sorted);
  const lines = [
    `AI Secure DevOps Pipeline Analyzer`,
    `Project: ${project.primary || "Unknown"}`,
    `Score: ${score.score}/100 (${score.label})`,
    `Issues: ${sorted.length}`,
    "",
    `Severity counts: critical=${score.counts.critical}, high=${score.counts.high}, medium=${score.counts.medium}, low=${score.counts.low}`,
    ""
  ];

  if (!sorted.length) {
    lines.push("No issues found.");
    return lines.join("\n");
  }

  sorted.forEach((issue, index) => {
    lines.push(`${index + 1}. [${issue.sev.toUpperCase()}] ${issue.title}`);
    lines.push(`Stage: ${STAGE_LABELS[issue.stage] || issue.stage || "General"}`);
    lines.push(`File: ${issue.file}`);
    lines.push(`Why: ${issue.desc}`);
    lines.push(`Fix:`);
    lines.push(issue.fix);
    lines.push("");
  });

  return lines.join("\n");
}

export function countBySeverity(issues) {
  return issues.reduce(
    (counts, issue) => {
      const sev = issue.sev || "medium";
      counts[sev] = (counts[sev] || 0) + 1;
      return counts;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );
}

export function getScoreLabel(score) {
  if (score >= 90) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Needs work";
  return "Urgent fixes needed";
}

function getScoreColor(score) {
  if (score >= 90) return "#15803d";
  if (score >= 70) return "#b45309";
  if (score >= 50) return "#c2410c";
  return "#b91c1c";
}

function renderScoreSummary(score) {
  return `
    <div class="score-summary" style="--score:${score.score}; --score-color:${score.color}">
      <div class="score-ring"><span>${score.score}</span></div>
      <div>
        <h3>${escapeHtml(score.label)}</h3>
        <p class="empty-state">Score is calculated from critical, high, medium, and low findings.</p>
        <div class="severity-counts">
          <span>Critical ${score.counts.critical}</span>
          <span>High ${score.counts.high}</span>
          <span>Medium ${score.counts.medium}</span>
          <span>Low ${score.counts.low}</span>
        </div>
      </div>
    </div>
  `;
}

function renderReportIssue(issue) {
  return `
    <article class="issue-row" data-issue-id="${escapeHtml(issue.id || "")}">
      <div class="issue-head">
        <div>
          <p class="issue-title">${escapeHtml(issue.title)}</p>
          <span class="issue-file">${escapeHtml(STAGE_LABELS[issue.stage] || issue.stage || "General")} / ${escapeHtml(issue.file || "project")}</span>
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
