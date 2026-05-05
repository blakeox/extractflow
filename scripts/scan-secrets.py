#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

TEXT_EXTENSIONS = {
    ".cjs",
    ".conf",
    ".css",
    ".env",
    ".example",
    ".go",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".rs",
    ".sh",
    ".sql",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}

EXCLUDED_PATH_PARTS = {
    ".git",
    ".venv",
    "node_modules",
    "dist",
    "build",
    "target",
    "test-results",
    "__pycache__",
}

EXCLUDED_FILENAMES = {
    "package-lock.json",
    "Cargo.lock",
}

ALLOW_MARKER = "allow-secret-scan"

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |)PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    (
        "Suspicious credential assignment",
        re.compile(
            r"""(?ix)
            \b(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)\b
            \s*[:=]\s*
            ["']?
            ([A-Za-z0-9_./+=:@-]{16,})
            ["']?
            """
        ),
    ),
]

SAFE_VALUE_FRAGMENTS = {
    "changeme",
    "example",
    "placeholder",
    "dummy",
    "sample",
    "test",
    "mock",
    "localhost",
    "127.0.0.1",
    "your-",
    "xxx",
}


def git_paths(command: list[str]) -> list[Path]:
    result = subprocess.run(
        command,
        cwd=ROOT_DIR,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
    )
    return [ROOT_DIR / Path(item.decode("utf-8")) for item in result.stdout.split(b"\x00") if item]


def candidate_paths(staged_only: bool) -> list[Path]:
    if staged_only:
        paths = git_paths(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    else:
        paths = git_paths(["git", "ls-files", "-z"])

    filtered: list[Path] = []
    for path in paths:
        if not path.is_file():
            continue
        if path.name in EXCLUDED_FILENAMES:
            continue
        if any(part in EXCLUDED_PATH_PARTS for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_EXTENSIONS and path.name not in {".env.example", ".gitignore"}:
            continue
        filtered.append(path)
    return filtered


def is_binary(data: bytes) -> bool:
    return b"\x00" in data


def looks_like_placeholder(value: str) -> bool:
    lowered = value.lower()
    return any(fragment in lowered for fragment in SAFE_VALUE_FRAGMENTS)


def scan_file(path: Path) -> list[str]:
    data = path.read_bytes()
    if is_binary(data):
        return []

    text = data.decode("utf-8", errors="ignore")
    findings: list[str] = []

    for line_number, line in enumerate(text.splitlines(), start=1):
        if ALLOW_MARKER in line:
            continue

        for label, pattern in PATTERNS:
            match = pattern.search(line)
            if not match:
                continue

            if label == "Suspicious credential assignment":
                value = match.group(1)
                if looks_like_placeholder(value):
                    continue

            findings.append(f"{path.relative_to(ROOT_DIR)}:{line_number}: {label}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan tracked files for likely secrets.")
    parser.add_argument("--staged", action="store_true", help="Only scan staged files.")
    args = parser.parse_args()

    paths = candidate_paths(staged_only=args.staged)
    findings: list[str] = []
    for path in paths:
        findings.extend(scan_file(path))

    if findings:
        print("Potential secrets detected:")
        for finding in findings:
            print(f" - {finding}")
        print(f"\nIf a match is intentional, add '{ALLOW_MARKER}' to that specific line.")
        return 1

    scope = "staged files" if args.staged else "tracked files"
    print(f"Secret scan passed for {scope}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
