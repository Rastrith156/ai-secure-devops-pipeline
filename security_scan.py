"""Scan the repository for hard-coded secrets and credentials.

Walks the working tree, applies compiled regex patterns against every
non-comment line, and exits non-zero when any match scores above the
risk threshold.  Designed to run fast even on large repos by:

  * pre-compiling all regexes once at import time
  * pruning irrelevant directories during os.walk()
  * skipping binary / non-target file extensions early
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from typing import Generator

# ── Configuration ────────────────────────────────────────────────────

EXCLUDE_DIRS: frozenset[str] = frozenset({
    "venv", ".venv", "__pycache__", ".git", "node_modules", ".tox",
})

EXCLUDE_FILES: frozenset[str] = frozenset({
    "security_scan.py",
})

TARGET_EXTENSIONS: frozenset[str] = frozenset({
    ".py", ".env", ".yaml", ".yml", ".json",
    ".cfg", ".ini", ".txt", ".sh", ".toml",
})

RISK_THRESHOLD: int = 8


# ── Pattern definitions ─────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class SecretPattern:
    """A single regex rule with a human-readable label and risk weight."""
    regex: re.Pattern[str]
    label: str
    weight: int


_RAW_PATTERNS: tuple[tuple[str, str, int], ...] = (
    # Generic assignments
    (r"(?i)api_key\s*=\s*[\"']?\S+",                      "API key assignment",                    10),
    (r"(?i)token\s*=\s*[\"']?\S+",                         "Token assignment",                      10),
    (r"(?i)secret\s*=\s*[\"']?\S+",                        "Secret assignment",                     10),
    (r"(?i)password\s*=\s*[\"']?\S+",                      "Password assignment",                   10),
    (r"(?i)auth\s*=\s*[\"']?\S+",                          "Auth value assignment",                  5),
    (r"(?i)private_key\s*=\s*[\"']?\S+",                   "Private key assignment",                15),
    # Provider-specific high-confidence patterns
    (r"AKIA[0-9A-Z]{16}",                                  "AWS access key ID",                     20),
    (r"sk-[a-zA-Z0-9]{32,}",                               "OpenAI API key",                        20),
    (r"ghp_[a-zA-Z0-9]{36}",                               "GitHub personal access token",          20),
    (r"-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----", "Embedded private key block",            25),
    (r"(?i)jdbc:[a-z]+://\S+:\S+@",                        "JDBC connection string w/ credentials", 20),
    (r"(?i)mongodb(?:\+srv)?://[^:]+:[^@]+@",              "MongoDB URI w/ credentials",            20),
)

PATTERNS: tuple[SecretPattern, ...] = tuple(
    SecretPattern(re.compile(raw), label, weight)
    for raw, label, weight in _RAW_PATTERNS
)


# ── Data containers ──────────────────────────────────────────────────

@dataclass(slots=True)
class Finding:
    """One flagged line inside a file."""
    line_no: int
    content: str
    score: int
    matched: list[str] = field(default_factory=list)


# ── Core logic ───────────────────────────────────────────────────────

def _is_scannable(filepath: str) -> bool:
    """Decide whether *filepath* should be scanned at all."""
    basename = os.path.basename(filepath)
    if basename in EXCLUDE_FILES:
        return False
    _, ext = os.path.splitext(basename)
    return ext in TARGET_EXTENSIONS


def _score_line(line: str) -> tuple[int, list[str]]:
    """Return (cumulative_risk, matched_labels) for a single line."""
    total = 0
    hits: list[str] = []
    for pat in PATTERNS:
        if pat.regex.search(line):
            total += pat.weight
            hits.append(pat.label)
    return total, hits


def scan_file(filepath: str) -> list[Finding]:
    """Read *filepath* and return every line that triggers a pattern."""
    findings: list[Finding] = []
    try:
        with open(filepath, "r", errors="ignore") as fh:
            for lineno, raw in enumerate(fh, start=1):
                stripped = raw.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                score, labels = _score_line(stripped)
                if score >= RISK_THRESHOLD:
                    findings.append(
                        Finding(lineno, stripped, score, labels)
                    )
    except OSError as exc:
        print(f"  warn: could not read {filepath}: {exc}", file=sys.stderr)
    return findings


def _walk_targets(root: str = ".") -> Generator[str, None, None]:
    """Yield every scannable file path under *root*."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for name in filenames:
            full = os.path.join(dirpath, name)
            if _is_scannable(full):
                yield full


# ── Entry point ──────────────────────────────────────────────────────

def main() -> int:
    """Run the scan and return an appropriate exit code."""
    total_findings = 0
    files_scanned = 0

    for filepath in _walk_targets():
        files_scanned += 1
        hits = scan_file(filepath)
        if not hits:
            continue
        print(f"\n  {filepath}")
        for f in hits:
            print(f"    line {f.line_no}  [risk {f.score}]  {', '.join(f.matched)}")
            print(f"    > {f.content[:120]}")
            total_findings += 1

    print(f"\nScanned {files_scanned} file(s).")

    if total_findings:
        print(f"{total_findings} potential secret(s) found — review before committing.\n")
        return 1

    print("No secrets or credentials detected.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
