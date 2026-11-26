#!/usr/bin/env python3
"""
check_secrets.py — block credentials from entering the repository.

Ported from MLX Studio's scanner (same rules and exit codes), plus the portfolio
additions: SEC-025 and SEC-026 (env-style and YAML password lines), SEC-030 (files
that must never be committed) and the hashed list of known test fixtures. Runs with
the Python
standard library only, so there is no pip step. Used by three callers:

  * .githooks/pre-commit   staged content only
  * .githooks/pre-push     commits about to leave the machine
  * .github/workflows/security.yml   full tree, every push and PR

Exit codes
  0  clean
  1  findings (blocks the commit or push)
  2  usage error

Usage
  ./scripts/check_secrets.py                 scan the working tree (tracked files)
  ./scripts/check_secrets.py --staged        scan staged content only
  ./scripts/check_secrets.py --range A..B    scan every blob a commit range adds
  ./scripts/check_secrets.py --range SHA --remote origin
                                             scan every commit of SHA that the
                                             remote does not have yet
  ./scripts/check_secrets.py --all-history   scan every blob in history
  ./scripts/check_secrets.py --tree SHA      scan the committed files of one commit
  ./scripts/check_secrets.py --list-rules    print the rule table

Findings report the rule and path:line only. The matched line is never printed,
because this output ends up in CI logs and pull request comments.
"""

from __future__ import annotations

import argparse
import codecs
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

# ── rules ────────────────────────────────────────────────────────────────────
# (id, description, pattern, severity)
# severity "block" fails the run; "warn" is reported but does not fail.
RULES: list[tuple[str, str, str, str]] = [
    # Cloud and platform tokens with recognisable prefixes
    ("SEC-001", "GitHub personal access token (classic)", r"ghp_[A-Za-z0-9]{36}", "block"),
    ("SEC-002", "GitHub OAuth token", r"gho_[A-Za-z0-9]{36}", "block"),
    ("SEC-003", "GitHub app token", r"(?:ghu|ghs)_[A-Za-z0-9]{36}", "block"),
    ("SEC-004", "GitHub fine-grained token", r"github_pat_[A-Za-z0-9_]{22,}", "block"),
    ("SEC-005", "OpenAI-style key", r"sk-(?:proj-|ant-)?[A-Za-z0-9_\-]{20,}", "block"),
    ("SEC-006", "Anthropic key", r"sk-ant-[A-Za-z0-9\-_]{20,}", "block"),
    ("SEC-007", "AWS access key id", r"AKIA[0-9A-Z]{16}", "block"),
    (
        "SEC-008",
        "AWS secret access key assignment",
        r"aws_secret_access_key\s*[=:]\s*['\"]?[A-Za-z0-9/+=]{40}",
        "block",
    ),
    ("SEC-009", "Google API key", r"AIza[0-9A-Za-z\-_]{35}", "block"),
    ("SEC-010", "Slack token", r"xox[baprs]-[0-9A-Za-z\-]{10,}", "block"),
    ("SEC-011", "Stripe live key", r"sk_live_[0-9A-Za-z]{24,}", "block"),
    ("SEC-012", "Hugging Face token", r"hf_[A-Za-z0-9]{30,}", "block"),
    (
        "SEC-013",
        "Private key block",
        r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----",
        "block",
    ),
    (
        "SEC-014",
        "JSON Web Token",
        r"eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}",
        "block",
    ),
    # Generic assignments — higher false-positive rate, so scoped and warned
    (
        "SEC-020",
        "Hardcoded password assignment",
        r"(?i)\b(?:password|passwd|pwd)\s*[=:]\s*['\"](?P<secret>[^'\"\s]{8,})['\"]",
        "block",
    ),
    (
        "SEC-021",
        "Hardcoded secret assignment",
        (
            r"(?i)\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token)"
            r"\s*[=:]\s*['\"](?P<secret>[^'\"\s]{12,})['\"]"
        ),
        "block",
    ),
    (
        "SEC-022",
        "Bearer token literal",
        r"(?i)bearer\s+(?P<secret>[A-Za-z0-9\-._~+/]{20,}=*)",
        "warn",
    ),
    (
        "SEC-023",
        "Connection string with inline password",
        (
            r"(?i)(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp)://"
            r"[^:\s]+:(?P<secret>[^@\s]+)@"
        ),
        "block",
    ),
    # A long random-looking value assigned to an uppercase name: the .env shape.
    # Requires mixed case plus a digit so shell variables and paths do not match.
    (
        "SEC-024",
        "Env-style secret assignment",
        (
            r"(?m)^[A-Z][A-Z0-9_]{2,}\s*=\s*[\"']?(?P<secret>(?=[A-Za-z0-9_\-]*[a-z])"
            r"(?=[A-Za-z0-9_\-]*[A-Z])(?=[A-Za-z0-9_\-]*\d)[A-Za-z0-9_\-]{20,})[\"']?\s*$"
        ),
        "warn",
    ),
    # This project's secrets live in NAME=value lines (.env, shell, Dockerfile,
    # compose lists). No spaces around "=", so `const PASSWORD = ...` stays with
    # SEC-020. The `assigned` group is read by literal_value().
    (
        "SEC-025",
        "Env-style password, token or key line",
        (
            r"^\s*(?:(?:export|local|readonly|ENV|ARG|-)\s+|#\s*)?"
            r"(?:[A-Z0-9_]*(?:PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|API_?KEY"
            r"|SECRET_KEY|ACCESS_KEY|PRIVATE_KEY)|(?:[A-Z0-9_]*_)?PASS|[A-Z0-9_]*_PWD)"
            r"=(?P<assigned>.*)$"
        ),
        "block",
    ),
    # The same names as YAML keys, in YAML files only (RULE_PATHS).
    (
        "SEC-026",
        "YAML password, token or key value",
        (
            r"(?i)^\s*(?:[-#]\s*)?[\"']?[\w.\-]*(?:password|passwd|passphrase|secret|token"
            r"|api[_\-]?key|secret[_\-]?key|access[_\-]?key|private[_\-]?key"
            r"|(?<![a-z0-9])pass|_pwd)[\"']?\s*:\s+(?P<scalar>.*)$"
        ),
        "block",
    ),
]

# Rules that apply to some files only.
RULE_PATHS = {"SEC-026": re.compile(r"(?i)\.ya?ml(?:\.[a-z]+)?$")}

# SEC-030: a file that must never be committed, whatever it holds.
FORBIDDEN_PATH_RE = re.compile(
    r"^data/"
    r"|(?:^|/)(?:\.env(?:\.(?!example$)[^/]*)?|admin-credentials[^/]*|id_(?:rsa|ed25519|ecdsa)"
    r"|[^/]+\.(?:pem|key|p12|pfx|db|db-wal|db-shm|dump))$",
    re.IGNORECASE,
)

COMPILED = [(rid, desc, re.compile(pat), sev) for rid, desc, pat, sev in RULES]

# ── allowlist ────────────────────────────────────────────────────────────────
# No folder, file type or file size is skipped: only files git lists are read, and
# each of them would be published.

# Placeholder shapes. Only the secret value is judged (the named `secret` group,
# else the whole token match), never a key name, user name or the rest of the line.
# A value is a placeholder when it is wholly an <angle> name or a variable, or
# when placeholder words, x-runs and ellipses cover at least half of it.
PLACEHOLDER_PART_RE = re.compile(
    r"(?i)example|placeholder|dummy|redacted|sample|fake|change[_-]?me|"
    r"your[_-]?(?:api[_-]?)?(?:token|key|password|secret)|test[_-]?key|"
    r"x{4,}|\.{3}|…"
)
ANGLE_RE = re.compile(r"<[A-Za-z0-9_\- ]+>")
# A lower-case word phrase led by a placeholder word, no digits: example-only-value.
PHRASE_RE = re.compile(r"(?:example|sample|dummy|fake|placeholder|redacted)(?:[-_.][a-z]+)*")

# A variable reference is a placeholder only when it is the whole secret value: a
# real password may hold a dollar sign. The bare form must be upper case.
VARIABLE_RE = re.compile(r"\$\{[A-Za-z0-9_]+\}|\$[A-Z_][A-Z0-9_]*")

# Parts of an assigned value that hold no literal text: ${VAR}, ${VAR:?message}
# and ${{ expression }}. In ${VAR:-text} the text is a literal, so it stays.
EXPRESSION_RE = re.compile(r"\$?\{\{(?:[^{}]|\{[^{}]*\})*\}\}|\$\{\w+(?::?\?[^{}]*)?\}|`[^`]*`")
DEFAULT_RE = re.compile(r"\$\{\w+:?[-=+]([^{}]*)\}")
# The value itself: one quoted string, one <angle name>, or one word.
ASSIGNED_RE = re.compile(
    r"\"(?P<double>(?:\\.|[^\"\\])*)\"|'(?P<single>[^']*)'|(?P<angle><[^<>]*>)|(?P<word>\S*)"
)
# A value that is wholly $name or $NAME is a reference; mixed case may be a password.
SHELL_NAME_RE = re.compile(r"\$(?:[a-z_][a-z0-9_]*|[A-Z_][A-Z0-9_]*)")
# Shorter assigned values are flags, counters and words such as `write`.
MIN_ASSIGNED = 6

# Inline suppression: append this comment to a line that legitimately matches.
SUPPRESS_RE = re.compile(r"(?:secret-scan|gitleaks):\s*allow", re.IGNORECASE)

# Known non-secrets that sit in files and in history: (rule, path) -> SHA-256 of
# the exact value. Only that value at that path passes; any other value still
# blocks. For a new fixture prefer `secret-scan: allow` on its line. Never add the
# hash of a real credential: remove and rotate it instead.
FIXTURES: dict[tuple[str, str], set[str]] = {
    ("SEC-020", "deploy/postgres-init/10-app-role.sh"): {
        "c71e41636af841badcc444673d3f03a0456e73c606e5d25f2b930ed28f9b2061",
        "eb94c11d77f46a0290ba8c4fca1a7fd315b72e1e6c83146e42117c568cc3ea4d",
    },
    ("SEC-020", "tests/harness.mjs"): {
        "9ea4cff71e339748db0a5e9ba3bd820186ecf9414e056b5fd8b9b6b7bb32c3c6",
    },
    ("SEC-023", "deploy/bootstrap-env.sh"): {
        "d485d151435484b2d71f8841dd0e20c53d8c40e0ea2a53bf164e2ec75491b27f",
    },
    ("SEC-023", "tests/hardening.test.mjs"): {
        "4158cfb57a5e2620e71381f0ab4360455ce5558fb93f0666c3147099bce5b523",
        "596f4162a52f315b2ad0fa53fd30a2769d02a41ed7439123790966eee4ceb5cd",
        "b444e12290741187be580dac7586ae0872108f49e23a249accf0b36e98726f9c",
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "ceb561a3f81253da8f610f3e4644e980b3042308b741ef33f83700c34a4a20d9",
    },
}


# ── git helpers ──────────────────────────────────────────────────────────────
def git(*args: str, text: bool = True) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=text, check=False)
    if result.returncode != 0:
        stderr = result.stderr if text else result.stderr.decode("utf-8", "replace")
        raise RuntimeError(f"git {' '.join(args)} failed: {stderr.strip()}")
    return result.stdout


def repo_root() -> Path:
    return Path(git("rev-parse", "--show-toplevel").strip())


def tracked_files() -> list[str]:
    out = git("ls-files", "-z")
    return [p for p in out.split("\0") if p]


def staged_files() -> list[str]:
    out = git("diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z")
    return [p for p in out.split("\0") if p]


def decode(data: bytes) -> str:
    """Text of any file: an odd encoding must neither crash nor hide a token."""
    utf16 = data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE))
    return data.decode("utf-16" if utf16 else "utf-8", "replace")


def staged_content(path: str) -> str | None:
    return blob_content(f":{path}")


def changed_blobs(revisions: list[str]) -> list[tuple[str, str]]:
    """(blob_sha, path) of every file a commit adds or changes, against each parent."""
    out = git(
        "log", "--format=", "--raw", "-z", "--no-abbrev", "--no-renames", "--root",
        "--diff-merges=separate", "--no-show-signature", *revisions,
    )
    fields = iter(out.split("\0"))
    pairs: list[tuple[str, str]] = []
    for field in fields:
        meta = field.lstrip("\n")
        if not meta.startswith(":"):
            continue
        _, mode, _, sha, _ = meta.split()
        path = next(fields)
        if mode not in ("000000", "160000"):  # deleted, or a submodule
            pairs.append((sha, path))
    return pairs


def history_blobs(revisions: list[str]) -> list[tuple[str, str]]:
    """Every (blob_sha, path) pair behind `revisions`.

    `rev-list --objects` finds every blob but names only one path for each, so the
    paths of each commit are added: a second name must pass the path rules too.
    """
    objects = git("rev-list", "--objects", *revisions)
    if not objects:
        return []
    result = subprocess.run(
        ["git", "cat-file", "--batch-check=%(objecttype) %(objectname) %(rest)"],
        input=objects,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git cat-file failed: {result.stderr.strip()}")
    blobs: list[tuple[str, str]] = []
    for line in result.stdout.splitlines():
        parts = line.split(" ", 2)
        if len(parts) == 3 and parts[0] == "blob":
            blobs.append((parts[1], parts[2]))
    return list(dict.fromkeys(blobs + changed_blobs(revisions)))


def outgoing_blobs(rev_range: str, remote: str | None = None) -> list[tuple[str, str]]:
    """Every (blob_sha, path) that `rev_range` would publish.

    A diff of the two ends misses a secret added in one commit and removed in a
    later one, so walk the commits. A single revision (a new branch) means all of
    its commits that no remote-tracking branch of `remote` already has.
    """
    revisions = [rev_range]
    if ".." not in rev_range:
        revisions += ["--not", f"--remotes={remote}" if remote else "--remotes"]
    return history_blobs(revisions)


def all_history_blobs() -> list[tuple[str, str]]:
    """Every (blob_sha, path) pair reachable from any ref."""
    return history_blobs(["--all"])


def tree_blobs(rev: str) -> list[tuple[str, str]]:
    """Every (blob_sha, path) committed in `rev`, whatever the working tree holds."""
    pairs: list[tuple[str, str]] = []
    for entry in git("ls-tree", "-r", "-z", "--full-tree", rev).split("\0"):
        if entry:
            meta, path = entry.split("\t", 1)
            _, kind, sha = meta.split()
            if kind == "blob":
                pairs.append((sha, path))
    return pairs


def blob_content(sha: str) -> str | None:
    result = subprocess.run(["git", "cat-file", "-p", sha], capture_output=True, check=False)
    if result.returncode != 0:
        return None
    return decode(result.stdout)


# ── scanning ─────────────────────────────────────────────────────────────────
class Finding:
    __slots__ = ("desc", "line", "path", "rule", "severity")

    def __init__(self, rule, desc, severity, path, line):
        self.rule = rule
        self.desc = desc
        self.severity = severity
        self.path = path
        self.line = line

    def render(self) -> str:
        colour = "\033[31m" if self.severity == "block" else "\033[33m"
        reset = "\033[0m"
        return (
            f"  {colour}{self.severity.upper():5s}{reset} {self.rule}  "
            f"{self.path}:{self.line}  {self.desc}"
        )


def drop_commands(text: str) -> str:
    """`text` without its $( ... ) command substitutions; unchanged if one is open."""
    kept, depth, i = [], 0, 0
    while i < len(text):
        if text.startswith("$(", i):
            depth, i = depth + 1, i + 2
            continue
        if depth:
            depth += {"(": 1, ")": -1}.get(text[i], 0)
        else:
            kept.append(text[i])
        i += 1
    return text if depth else "".join(kept)


def literal_value(rest: str, yaml: bool) -> str:
    """The literal text assigned by the part of a line after `NAME=` or `key:`."""
    text = DEFAULT_RE.sub(r"\1", EXPRESSION_RE.sub("", drop_commands(rest))).strip()
    found = ASSIGNED_RE.match(text)
    kind = found.lastgroup or "word"
    value = found.group(kind)
    if kind == "word":
        after = text[found.end():].strip()
        if yaml and (value.startswith("*") or (after and not after.startswith("#"))):
            return ""  # a YAML alias, or a sentence rather than a value
        value = value.rstrip(";")
    return "" if SHELL_NAME_RE.fullmatch(value) else value


def secret_value(match: re.Match) -> str:
    """The text that is judged: never a key name or the rest of the line."""
    groups = match.groupdict()
    if "assigned" in groups:
        return literal_value(groups["assigned"], yaml=False)
    if "scalar" in groups:
        return literal_value(groups["scalar"], yaml=True)
    return groups.get("secret") or match.group()


def is_placeholder(match: re.Match) -> bool:
    value = secret_value(match)
    assigned = {"assigned", "scalar"} & match.groupdict().keys()
    if assigned and len(value) < MIN_ASSIGNED:
        return True
    if any(r.fullmatch(value) for r in (VARIABLE_RE, ANGLE_RE, PHRASE_RE)):
        return True
    covered = sum(len(m.group()) for m in PLACEHOLDER_PART_RE.finditer(value))
    return covered * 2 >= len(value)


def is_fixture(rule: str, path: str, match: re.Match) -> bool:
    value = secret_value(match)
    return hashlib.sha256(value.encode()).hexdigest() in FIXTURES.get((rule, path), ())


def check_path(path: str, findings: list[Finding]) -> None:
    if FORBIDDEN_PATH_RE.search(path):
        desc = "File that must never be committed"
        findings.append(Finding("SEC-030", desc, "block", path, 0))


def scan_text(path: str, text: str, findings: list[Finding]) -> None:
    rules = [r for r in COMPILED if r[0] not in RULE_PATHS or RULE_PATHS[r[0]].search(path)]
    for lineno, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        if SUPPRESS_RE.search(line):
            continue
        found = None
        for rid, desc, pattern, severity in rules:
            if all(is_placeholder(m) or is_fixture(rid, path, m) for m in pattern.finditer(line)):
                continue  # no match, or placeholders and known fixtures only
            if severity == "block":
                found = Finding(rid, desc, severity, path, lineno)
                break
            found = found or Finding(rid, desc, severity, path, lineno)
        if found:
            findings.append(found)  # one per line; a block outranks a warning


def scan_paths(paths: list[str], reader, findings: list[Finding]) -> None:
    for path in paths:
        check_path(path, findings)
        text = reader(path)
        if text is None:
            continue
        scan_text(path, text, findings)


def scan_blobs(blobs: list[tuple[str, str]], findings: list[Finding]) -> None:
    for sha, path in blobs:
        check_path(path, findings)
        text = blob_content(sha)
        if text is not None:
            scan_text(path, text, findings)


def read_worktree(root: Path):
    def reader(path: str) -> str | None:
        full = root / path
        try:
            if not full.is_file():
                return None
            return decode(full.read_bytes())
        except OSError:
            return None

    return reader


# ── entry point ──────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Block credentials from entering the repository.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--staged", action="store_true", help="scan staged content only")
    group.add_argument("--range", metavar="A..B", help="scan a commit range")
    group.add_argument("--all-history", action="store_true", help="scan every blob in history")
    group.add_argument("--tree", metavar="SHA", help="scan the committed files of one commit")
    group.add_argument("--list-rules", action="store_true", help="print the rule table")
    parser.add_argument("--remote", help="with --range SHA: the remote being pushed to")
    parser.add_argument("--quiet", action="store_true", help="only print on failure")
    args = parser.parse_args()

    if args.list_rules:
        print(f"{'ID':8s} {'SEVERITY':9s} DESCRIPTION")
        for rid, desc, _pat, sev in RULES:
            print(f"{rid:8s} {sev:9s} {desc}")
        print("SEC-030  block     File that must never be committed (path rule)")
        return 0

    findings: list[Finding] = []
    root = repo_root()
    os.chdir(root)  # from a subfolder, git would list and name only part of the tree

    if args.staged:
        scan_paths(staged_files(), staged_content, findings)
        scope = "staged content"
    elif args.range:
        scan_blobs(outgoing_blobs(args.range, args.remote), findings)
        scope = f"range {args.range}"
    elif args.all_history:
        scan_blobs(all_history_blobs(), findings)
        scope = "all history"
    elif args.tree:
        scan_blobs(tree_blobs(args.tree), findings)
        scope = f"tree of {args.tree}"
    else:
        scan_paths(tracked_files(), read_worktree(root), findings)
        scope = "working tree"

    blocking = [f for f in findings if f.severity == "block"]
    warning = [f for f in findings if f.severity != "block"]

    if findings:
        print(f"\n\033[1mSecret scan — {scope}\033[0m")
        for f in findings:
            print(f.render())
        print()

    if blocking:
        print(f"\033[31m✗ {len(blocking)} blocking finding(s)\033[0m in {scope}.")
        print("  Remove the credential, or add `secret-scan: allow` to the line if it is a")
        print("  deliberate non-secret. Then re-run: ./scripts/check_secrets.py")
        return 1

    if warning and not args.quiet:
        print(f"\033[33m⚠ {len(warning)} warning(s)\033[0m — not blocking, review above.")

    if not args.quiet:
        print(
            f"\033[32m✓ no credentials found\033[0m in {scope} "
            f"({len(RULES) + 1} rules, {len(blocking)} blocking, {len(warning)} warnings)"
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as exc:
        print(f"secret scan failed: {exc}", file=sys.stderr)
        sys.exit(2)
