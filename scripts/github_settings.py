#!/usr/bin/env python3
"""
github_settings.py — the GitHub-side security settings, as one re-runnable script.

  ./scripts/github_settings.py check              read and compare (GET only)
  ./scripts/github_settings.py create  [--apply]  create the public repository, empty
  ./scripts/github_settings.py settings [--apply] before the first push: repository,
                                                  scanning, Dependabot, Actions, labels
  ./scripts/github_settings.py protect [--apply]  after the first push and green checks:
                                                  CodeQL and the two rulesets

Without --apply nothing is written: the requests are only printed. `create` never
touches an existing repository; `settings` and `protect` refuse a repository that
is not public, so a private one with the same name is never changed.

The token is read from the environment variable GITHUB_PERSONAL_ACCESS_TOKEN and
sent only in the request header: never on a command line, never printed.
Standard library only. If Python cannot verify certificates (python.org builds on
macOS), run with SSL_CERT_FILE=/etc/ssl/cert.pem; verification is never disabled.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

OWNER = "DipeshPansuriya"
REPO = "portfolio-app"
BASE = f"/repos/{OWNER}/{REPO}"
DESCRIPTION = "Interactive portfolio: 3D drive circuit, reading mode and a content editor."
TOPICS = ["portfolio", "react", "typescript", "threejs", "vite", "nodejs", "postgresql"]

# Job names in .github/workflows/. "Image build and scan" is left out until it has
# passed on GitHub; it also fails on purpose once the PostgreSQL accept list expires.
REQUIRED_CHECKS = [
    "Secret scan",
    "Security audit",
    "Hook installer",
    "Typecheck",
    "Syntax gates",
    "Documentation links",
    "Tests",
    "Build and bundle budget",
    "Automated review",
]
# The app that must report them: GitHub Actions (GET /apps/github-actions). Matched by name
# only, a status of the same name from any other app or token would satisfy the rule.
ACTIONS_APP_ID = 15368

REPO_SETTINGS = {
    "description": DESCRIPTION,
    "has_issues": True,
    "has_wiki": True,
    "has_projects": True,
    "has_discussions": False,
    "allow_squash_merge": True,
    "allow_merge_commit": True,
    "allow_rebase_merge": False,
    "delete_branch_on_merge": True,
    # Off: code on main runs where it can deploy, so every pull request, Dependabot's too,
    # is read and merged by hand.
    "allow_auto_merge": False,
    "allow_update_branch": True,
}
SCANNING = {
    "security_and_analysis": {
        "secret_scanning": {"status": "enabled"},
        "secret_scanning_push_protection": {"status": "enabled"},
    }
}
ACTIONS = {"enabled": True, "allowed_actions": "all", "sha_pinning_required": True}
TOKEN_DEFAULTS = {"default_workflow_permissions": "read", "can_approve_pull_request_reviews": False}
FORK_APPROVAL = {"approval_policy": "all_external_contributors"}
CODEQL = {
    "state": "configured",
    "query_suite": "default",
    "languages": ["actions", "javascript-typescript", "python"],
}
LABELS = {
    "dependencies": "0366d6",
    "github-actions": "000000",
    "javascript": "f1e05a",
    "docker": "0db7ed",
}
RULESETS = [
    {
        "name": "main-protection",
        "target": "branch",
        "enforcement": "active",
        "bypass_actors": [],
        "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
        "rules": [
            {"type": "deletion"},
            {"type": "non_fast_forward"},
            {"type": "required_linear_history"},
            {
                "type": "pull_request",
                "parameters": {
                    # 0: one maintainer cannot approve their own pull request.
                    "required_approving_review_count": 0,
                    "dismiss_stale_reviews_on_push": True,
                    "require_code_owner_review": False,
                    "require_last_push_approval": False,
                    "required_review_thread_resolution": True,
                    "allowed_merge_methods": ["squash", "merge"],
                },
            },
            {
                "type": "required_status_checks",
                "parameters": {
                    "strict_required_status_checks_policy": True,
                    "do_not_enforce_on_create": False,
                    "required_status_checks": [
                        {"context": name, "integration_id": ACTIONS_APP_ID} for name in REQUIRED_CHECKS
                    ],
                },
            },
        ],
    },
    {
        "name": "release-tags",
        "target": "tag",
        "enforcement": "active",
        "bypass_actors": [],
        "conditions": {"ref_name": {"include": ["refs/tags/v*"], "exclude": []}},
        # "update": an existing tag cannot be moved at all, not even forward.
        "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}, {"type": "update"}],
    },
]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """The token header must never follow a redirect to another address."""

    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect)
APPLY = False
FAILED: list[str] = []


def call(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    token = os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN", "")
    if not token:
        sys.exit("GITHUB_PERSONAL_ACCESS_TOKEN is not set")
    request = urllib.request.Request(
        "https://api.github.com" + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "repo-settings",
        },
    )
    try:
        with OPENER.open(request, timeout=40) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read())
        except ValueError:
            return error.code, None
    except urllib.error.URLError as error:
        sys.exit(f"cannot reach GitHub: {error.reason}")


def write(method: str, path: str, body: dict | None = None, accept: tuple[int, ...] = ()) -> None:
    if not APPLY:
        print(f"  would {method} {path} {json.dumps(body) if body is not None else ''}")
        return
    status, answer = call(method, path, body)
    good = status < 300 or status in accept
    print(f"  {'ok  ' if good else 'FAIL'} {status} {method} {path}")
    if not good:
        detail = answer if isinstance(answer, dict) else {}
        print(f"       {detail.get('message')} {detail.get('errors') or ''}")
        FAILED.append(f"{method} {path}")


def repository() -> dict | None:
    status, body = call("GET", BASE)
    if status == 404:
        return None
    if status != 200:
        sys.exit(f"GET {BASE} answered {status}")
    return body


def require_public() -> None:
    repo = repository()
    if repo is None:
        if APPLY:
            sys.exit(f"{OWNER}/{REPO} does not exist: run `create --apply` first")
        print("  (repository does not exist yet)")
    elif repo["visibility"] != "public":
        sys.exit(f"{OWNER}/{REPO} is {repo['visibility']}: refusing to change it")


def create() -> None:
    repo = repository()
    if repo is not None:
        sys.exit(f"{OWNER}/{REPO} already exists ({repo['visibility']}): nothing done")
    write("POST", "/user/repos", {"name": REPO, "description": DESCRIPTION, "private": False, "auto_init": False})


def settings() -> None:
    require_public()
    write("PATCH", BASE, REPO_SETTINGS)
    write("PUT", f"{BASE}/topics", {"names": TOPICS})
    write("PATCH", BASE, SCANNING)
    write("PUT", f"{BASE}/vulnerability-alerts")
    write("PUT", f"{BASE}/automated-security-fixes")
    write("PUT", f"{BASE}/private-vulnerability-reporting")
    write("PUT", f"{BASE}/actions/permissions", ACTIONS)
    write("PUT", f"{BASE}/actions/permissions/workflow", TOKEN_DEFAULTS)
    write("PUT", f"{BASE}/actions/permissions/fork-pr-contributor-approval", FORK_APPROVAL)
    for name, colour in LABELS.items():
        # 422: the label is already there.
        write("POST", f"{BASE}/labels", {"name": name, "color": colour}, accept=(422,))


def protect() -> None:
    require_public()
    if APPLY and call("GET", f"{BASE}/branches/main")[0] != 200:
        sys.exit("there is no main branch yet: push first")
    write("PATCH", f"{BASE}/code-scanning/default-setup", CODEQL)
    status, existing = call("GET", f"{BASE}/rulesets?per_page=100")
    ids = {r["name"]: r["id"] for r in existing} if status == 200 else {}
    for ruleset in RULESETS:
        if ruleset["name"] in ids:
            write("PUT", f"{BASE}/rulesets/{ids[ruleset['name']]}", ruleset)
        else:
            write("POST", f"{BASE}/rulesets", ruleset)


def same(live: object, wanted: object) -> bool:
    """Equal; the order of a list does not matter."""
    if isinstance(wanted, list):
        return isinstance(live, list) and sorted(live) == sorted(wanted)
    return live == wanted


def check() -> None:
    def expect(label: str, ok: bool) -> None:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            FAILED.append(label)

    def get(path: str) -> tuple[int, dict]:
        status, body = call("GET", BASE + path)
        return status, body if isinstance(body, dict) else {}

    repo = repository()
    if repo is None:
        sys.exit(f"{OWNER}/{REPO} does not exist")
    expect(f"visibility is public (is {repo['visibility']})", repo["visibility"] == "public")
    for key, value in REPO_SETTINGS.items():
        expect(f"repository {key}", repo.get(key) == value)
    analysis = repo.get("security_and_analysis") or {}
    for key in (*SCANNING["security_and_analysis"], "dependabot_security_updates"):
        expect(key, analysis.get(key, {}).get("status") == "enabled")
    expect("Dependabot alerts", get("/vulnerability-alerts")[0] == 204)
    expect("private vulnerability reporting", get("/private-vulnerability-reporting")[1].get("enabled") is True)
    for path, wanted in (
        ("/actions/permissions", ACTIONS),
        ("/actions/permissions/workflow", TOKEN_DEFAULTS),
        ("/actions/permissions/fork-pr-contributor-approval", FORK_APPROVAL),
    ):
        body = get(path)[1]
        for key, value in wanted.items():
            expect(f"{path[1:]} {key}", body.get(key) == value)
    codeql = get("/code-scanning/default-setup")[1]
    expect("CodeQL default setup", codeql.get("state") == "configured")

    status, listed = call("GET", f"{BASE}/rulesets?per_page=100")
    ids = {r["name"]: r["id"] for r in listed} if status == 200 else {}
    for ruleset in RULESETS:
        name = ruleset["name"]
        live = get(f"/rulesets/{ids[name]}")[1] if name in ids else {}
        rules = {r["type"]: r.get("parameters") or {} for r in live.get("rules", [])}
        expect(f"ruleset {name} active", live.get("enforcement") == "active")
        expect(f"ruleset {name} has no bypass", bool(live) and live.get("bypass_actors") == [])
        expect(f"ruleset {name} target", live.get("target") == ruleset["target"])
        refs = (live.get("conditions") or {}).get("ref_name") or {}
        for side, wanted in ruleset["conditions"]["ref_name"].items():
            expect(f"ruleset {name} ref_name.{side}", same(refs.get(side), wanted))
        expect(f"ruleset {name} rules", {r["type"] for r in ruleset["rules"]} <= set(rules))
        # Only the parameters this script sends: GitHub adds others of its own.
        for rule in ruleset["rules"]:
            for key, wanted in rule.get("parameters", {}).items():
                have = rules.get(rule["type"], {}).get(key)
                if key == "required_status_checks":
                    # An extra check is stricter, so only a missing one (or another app) fails.
                    ok = {(c["context"], c["integration_id"]) for c in wanted} <= {
                        (c.get("context"), c.get("integration_id")) for c in have or []
                    }
                else:
                    ok = same(have, wanted)
                expect(f"ruleset {name} {rule['type']}.{key}", ok)
    for kind in ("dependabot", "secret-scanning", "code-scanning"):
        status, alerts = call("GET", f"{BASE}/{kind}/alerts?state=open&per_page=100")
        count = len(alerts) if status == 200 else f"unreadable ({status})"
        print(f"  INFO  open {kind} alerts: {count}")


def main() -> int:
    global APPLY
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["check", "create", "settings", "protect"])
    parser.add_argument("--apply", action="store_true", help="send the write requests")
    args = parser.parse_args()
    APPLY = args.apply
    {"check": check, "create": create, "settings": settings, "protect": protect}[args.action]()
    if FAILED:
        print(f"\n{len(FAILED)} failed")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
