"""Block tracked private data and a small set of recognizable credential formats.

This heuristic is a commit guard, not a claim to detect every possible secret.
It reports file paths only; it never prints matching credentials.
"""
import re
import subprocess
import sys
from pathlib import Path

SIGNATURES = (
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    re.compile(r"gh[pousr]_[0-9A-Za-z]{36,}"),
    re.compile(r"github_pat_[0-9A-Za-z_]{40,}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"),
)
TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".jsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".toml", ".md", ".html", ".sh", ".txt", ".in", ".example"}


def check_files(root: Path, paths: list[str]) -> list[str]:
    problems = []
    for name in paths:
        path = Path(name)
        if path.name == ".env" or (path.name.startswith(".env.") and path.name not in {".env.example", ".env.sample"}) or path.suffix in {".db", ".sqlite", ".sqlite3", ".p12", ".pfx"} or path.parts[0] == "data":
            problems.append(f"Private file must not be tracked: {name}")
            continue
        if path.suffix not in TEXT_SUFFIXES or (root / path).is_symlink():
            continue
        try:
            content = (root / path).read_text(encoding="utf-8")
        except (UnicodeError, OSError):
            continue
        if any(pattern.search(content) for pattern in SIGNATURES):
            problems.append(f"Possible credential in tracked file: {name}")
    return problems


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    problems = check_files(root, [name for name in paths if name])
    for problem in problems:
        print(problem, file=sys.stderr)
    if not problems:
        print("Tracked-file privacy and credential-pattern checks passed.")
    return int(bool(problems))


if __name__ == "__main__":
    sys.exit(main())
