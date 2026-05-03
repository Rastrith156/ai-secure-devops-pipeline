import os
import re
import sys

# 🚫 Exclude unnecessary directories
EXCLUDE_DIRS = ["venv", "__pycache__", ".git"]

# 🔍 Improved keywords (avoid false positives)
KEYWORDS = [
    "api_key=",
    "token=",
    "secret=",
    "password=",
    "auth="
]

# ⚠️ Risk threshold (>=5 will fail pipeline)
RISK_THRESHOLD = 5


def should_scan(path):
    return not any(excluded in path for excluded in EXCLUDE_DIRS)


def calculate_risk(line):
    risk = 0
    for keyword in KEYWORDS:
        if keyword in line.lower():
            risk += 5
    return risk


def scan_file(filepath):
    issues = []
    try:
        with open(filepath, "r", errors="ignore") as f:
            for i, line in enumerate(f, start=1):
                risk = calculate_risk(line)
                if risk > 0:
                    issues.append((i, line.strip(), risk))
    except Exception:
        pass
    return issues


def main():
    total_issues = 0

    for root, dirs, files in os.walk("."):
        # 🚫 Remove excluded dirs
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

        for file in files:
            if file.endswith(".py"):
                filepath = os.path.join(root, file)

                if not should_scan(filepath):
                    continue

                issues = scan_file(filepath)

                if issues:
                    print(f"\n❌ {filepath}")
                    for line_no, content, risk in issues:
                        print(f"   Line {line_no}: {content} (risk={risk})")
                        total_issues += 1

    # 🎯 Final result
    if total_issues >= 1:
        print("\n❌ Security issues detected!")
        sys.exit(1)
    else:
        print("\n✅ No critical security issues found!")


if __name__ == "__main__":
    main()
