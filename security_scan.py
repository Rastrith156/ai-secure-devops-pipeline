import os

suspicious_keywords = [
    "password", "secret", "api_key", "token", "auth", "credential"
]

def analyze_line(line):
    score = 0
    for word in suspicious_keywords:
        if word.lower() in line.lower():
            score += 1
    if "=" in line and "\"" in line:
        score += 1
    return score

def scan_file(file_path):
    issues = []
    with open(file_path, "r", errors="ignore") as f:
        for i, line in enumerate(f.readlines(), start=1):
            score = analyze_line(line)
            if score >= 2:
                issues.append((i, line.strip(), score))
    return issues

def scan_directory(path="."):
    found = False
    for root, _, files in os.walk(path):
        for file in files:
            if file.endswith(".py"):
                full_path = os.path.join(root, file)
                issues = scan_file(full_path)
                if issues:
                    print(f"\n❌ {full_path}")
                    for line_no, text, score in issues:
                        print(f"   Line {line_no}: {text} (risk={score})")
                    found = True
    return found

if __name__ == "__main__":
    if scan_directory():
        print("\n AI Security Risk Detected. Blocking build.")
        exit(1)
    else:
        print("\n Code looks safe.")
