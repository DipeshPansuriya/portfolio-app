#!/usr/bin/env python3
"""
check_docs.py — verify that every relative link in the documentation resolves.

Runs in CI and locally. Standard library only.

  ./scripts/check_docs.py            check docs/, deploy/ and the root documents
  ./scripts/check_docs.py --quiet    only print on failure

Exit codes
  0  every relative link resolves
  1  at least one link is broken
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Markdown inline links: [label](target)
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

# Schemes and anchors that are not filesystem paths.
EXTERNAL_PREFIXES = ("http://", "https://", "mailto:", "#", "tel:")

SCAN_GLOBS = (
    "docs/**/*.md",
    "deploy/*.md",
    "README.md",
    "CHANGELOG.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
)


def markdown_files() -> list[Path]:
    files: list[Path] = []
    for pattern in SCAN_GLOBS:
        files.extend(sorted(ROOT.glob(pattern)))
    return files


def check(quiet: bool = False) -> int:
    broken: list[tuple[str, str, str]] = []
    checked = 0

    for md in markdown_files():
        text = md.read_text(encoding="utf-8")
        for match in LINK_RE.finditer(text):
            label, target = match.group(1), match.group(2)
            if target.startswith(EXTERNAL_PREFIXES):
                continue
            path_part = target.split("#", 1)[0]
            if not path_part:
                continue
            checked += 1
            if not (md.parent / path_part).resolve().exists():
                broken.append((str(md.relative_to(ROOT)), label, target))

    if broken:
        print(f"\n\033[1mBroken relative links ({len(broken)})\033[0m")
        for source, label, target in broken:
            print(f"  \033[31mFAIL\033[0m  {source}  [{label}]({target})")
        print()
        return 1

    if not quiet:
        print(
            f"\033[32m✓ all {checked} relative links resolve\033[0m "
            f"across {len(markdown_files())} files"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify relative documentation links.")
    parser.add_argument("--quiet", action="store_true", help="only print on failure")
    args = parser.parse_args()
    return check(quiet=args.quiet)


if __name__ == "__main__":
    sys.exit(main())
