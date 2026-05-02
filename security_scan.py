import os
import re

# patterns for secrets
patterns = [
    r'password\s*=\s*["\'].*["\']',
    r'api[_-]?key\s*=\s*["\'].*["\']',
    r'secret\s*=\s*["\'].*["\']'
]

def scan_file(file_path):
    with open(file_path, "r", errors="ignore") as f:
        content = f.read()
        for pattern in patterns:
            if re.search(pattern, content, re.IGNORECASE):
                print(f"[WARNING] Possible secret found in {file_path}")
                return True
    return False

def scan_directory(path="."):
    found = False
    for root, _, files in os.walk(path):
        for file in files:
            if file.endswith(".py"):
                if scan_file(os.path.join(root, file)):
                    found = True
    return found

if __name__ == "__main__":
    if scan_directory():
        print("Security issues found!")
        exit(1)
    else:
        print("No secrets detected")
