#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# security_audit.sh — re-runnable security checks for the portfolio
#
#   ./scripts/security_audit.sh            full audit
#   ./scripts/security_audit.sh --quick    skip the dependency scan (no network)
#
# Exit code 0 when every check passes, 1 when any check fails.
# Findings are printed as PASS / FAIL / WARN / INFO with a stable check id.
# The ids follow MLX Studio's audit; SA-15 (shipped bundle matches source) has no
# counterpart here: the image is built from a commit and labelled with it.
# Needs bash, git, python3 and Node. Installs nothing.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT" || exit 1

QUICK=0
for arg in "$@"; do
    case "$arg" in
        --quick) QUICK=1 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

PASS=0; FAIL=0; WARN=0
FAILED_IDS=()

ok()   { printf '  \033[32mPASS\033[0m  %-6s %s\n' "$1" "$2"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %-6s %s\n' "$1" "$2"; FAIL=$((FAIL+1)); FAILED_IDS+=("$1"); }
warn() { printf '  \033[33mWARN\033[0m  %-6s %s\n' "$1" "$2"; WARN=$((WARN+1)); }
info() { printf '  \033[36mINFO\033[0m  %-6s %s\n' "$1" "$2"; }

section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# need <id> <file> <fixed string> <what it proves>
need() {
    if grep -qF -- "$3" "$2" 2>/dev/null; then ok "$1" "$4"; else bad "$1" "missing in $2: $4"; fi
}

# none <id> <pattern> <what it proves> <paths...>   (a missing path is a failure)
none() {
    local id="$1" pattern="$2" label="$3" path hits
    shift 3
    for path in "$@"; do
        [ -e "$path" ] || { bad "$id" "cannot check: $path is missing"; return; }
    done
    # file:line only: a matched line may hold the very value that must not be printed.
    hits="$(grep -rnE -- "$pattern" "$@" 2>/dev/null | cut -d: -f1,2 | head -3 | tr '\n' ' ')"
    if [ -n "$hits" ]; then bad "$id" "$label: found at $hits"; else ok "$id" "$label: none"; fi
}

SOURCES=(server shared src scripts/*.mjs deploy/checks deploy/offline-npm-cache.mjs public/theme-init.js vite.config.ts)
SHELL_FILES=()
while IFS= read -r f; do SHELL_FILES+=("$f"); done < <(git ls-files --cached --others --exclude-standard -- '*.sh' '.githooks/*')

# ── SA-01 static patterns ────────────────────────────────────────────────────
section "SA-01  Dangerous code patterns"
none SA-01 '(^|[^[:alnum:]_.])eval\(|new Function\(|dangerouslySetInnerHTML|innerHTML[[:space:]]*=|document\.write\(|shell:[[:space:]]*true|execSync\(' \
    "eval, Function, raw HTML, shell spawn" "${SOURCES[@]}"

# ── SA-02 network exposure ───────────────────────────────────────────────────
section "SA-02  Network exposure"
need SA-02 server/index.mjs "process.env.HOST || '127.0.0.1'" "the server listens on loopback unless told otherwise"
none SA-02 '(^|[^0-9.])0\.0\.0\.0|host:[[:space:]]*true' "bind to every interface in source or dev server" server shared src vite.config.ts
none SA-02 '^[[:space:]]+ports:' "published ports in the server stack" deploy/compose.yaml
need SA-02 deploy/compose.yaml "internal: true" "the database network has no way out"

# ── SA-03 path containment ───────────────────────────────────────────────────
section "SA-03  Static file containment"
need SA-03 server/static.mjs 'file.startsWith(dist + sep)' "a resolved file must stay inside dist/"

# ── SA-04 request body limits ────────────────────────────────────────────────
section "SA-04  Request body handling"
need SA-04 server/index.mjs 'size > MAX_BODY' "request bodies are bounded"

# ── SA-05 write endpoint surface ─────────────────────────────────────────────
section "SA-05  Endpoint surface"
need SA-05 server/index.mjs 'requestProblem(req, publicOrigins)' "writes check Host, Origin and content type"
writes="$(grep -cF 'requireSession(req, res, { csrf: true })' server/index.mjs 2>/dev/null || true)"
if [ "${writes:-0}" -ge 3 ]; then
    ok SA-05 "$writes signed-in write routes require the CSRF token"
else
    bad SA-05 "expected 3 or more routes with session and CSRF checks, found ${writes:-0}"
fi
for flag in "'HttpOnly'" "'SameSite=Strict'" "'Secure'"; do
    need SA-05 server/index.mjs "$flag" "cookie flag $flag"
done
need SA-05 server/index.mjs "\"script-src 'self'\"" "CSP allows only own scripts"
need SA-05 server/index.mjs 'TRUST_PROXY must be set in production' "production refuses to start without TRUST_PROXY"
need SA-05 server/index.mjs 'PUBLIC_ORIGIN must be set in production' "production refuses to start without PUBLIC_ORIGIN"

# ── SA-06 TLS verification ──────────────────────────────────────────────────
section "SA-06  TLS"
none SA-06 'rejectUnauthorized[[:space:]]*:[[:space:]]*false|NODE_TLS_REJECT_UNAUTHORIZED|strict-ssl[[:space:]]*=[[:space:]]*false|sslmode=no-verify' \
    "disabled certificate verification" server shared src scripts/*.mjs deploy/compose.yaml Dockerfile Jenkinsfile package.json

# ── SA-07 secrets in tracked files ──────────────────────────────────────────
section "SA-07  Secret leakage"
# Delegate to the single rule set so the audit and the git hooks cannot drift.
if [ -f "$ROOT/scripts/check_secrets.py" ]; then
    SCAN_OUT="$(python3 -B "$ROOT/scripts/check_secrets.py" --quiet 2>&1)"
    SCAN_RC=$?
    # A crash also exits 1, so only reported findings count as credentials.
    BLOCKING="$(printf '%s\n' "$SCAN_OUT" | grep -cE 'BLOCK.*SEC-[0-9]{3}' || true)"
    if [ "$SCAN_RC" -eq 0 ]; then
        ok SA-07 "no credentials in tracked files (check_secrets.py)"
    elif [ "$SCAN_RC" -eq 1 ] && [ "$BLOCKING" -gt 0 ]; then
        bad SA-07 "credentials found: $BLOCKING blocking finding(s); run ./scripts/check_secrets.py"
    else
        bad SA-07 "scanner failed (exit $SCAN_RC), nothing verified; run ./scripts/check_secrets.py"
    fi
else
    bad SA-07 "scripts/check_secrets.py missing; cannot scan"
fi

# ── SA-08 gitignore coverage ────────────────────────────────────────────────
section "SA-08  Ignore rules"
ignored() { git -c core.excludesFile=/dev/null check-ignore -q --no-index -- "$1"; }
MISSING=""
for sample in .env .env.local deploy/.env data/portfolio.db x.db x.db-wal admin-credentials.txt \
    x.pem x.key secrets.json x.dump x.log node_modules/x dist/x dist-server/x scripts/__pycache__/x.pyc \
    backups/a.sql.gz a.sql x.tgz x.tar.gz x.zip graphify-out/x .codegraph/x; do
    ignored "$sample" || MISSING="$MISSING $sample"
done
if [ -n "$MISSING" ]; then
    bad SA-08 "not ignored:$MISSING"
else
    ok SA-08 "env files, databases, keys, dumps, backups, archives, tool caches and build output are ignored"
fi
if dropped="$(git -c core.excludesFile=/dev/null ls-files -ci --exclude-standard)" && [ -z "$dropped" ] &&
    ! ignored .env.example && ! ignored src/data/icon-paths.ts && ! ignored deploy/backup/backup.sh; then
    ok SA-08 "no tracked file is ignored; .env.example, src/data/ and deploy/backup/ are kept"
else
    bad SA-08 "an ignore rule drops a tracked or needed file: $(printf '%s' "${dropped:-}" | head -n 3 | tr '\n' ' ')"
fi

# ── SA-09 tracked file permissions ──────────────────────────────────────────
section "SA-09  File permissions"
if WW="$(python3 -B - <<'PY'
import os, stat, subprocess
names = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout.split(b"\0")
print(" ".join(os.fsdecode(n) for n in names
               if n and os.path.isfile(n) and os.stat(n).st_mode & stat.S_IWOTH))
PY
)"; then
    if [ -n "$WW" ]; then bad SA-09 "world-writable tracked file: $WW"; else ok SA-09 "no world-writable tracked files"; fi
else
    bad SA-09 "could not read file permissions"
fi

# ── SA-10 runtime state permissions ─────────────────────────────────────────
section "SA-10  Runtime state permissions"
need SA-10 server/db.mjs 'chmodSync(credentialsFile, 0o600)' "the generated credentials file is owner-only"
need SA-10 server/db-sqlite.mjs 'chmodSync(target, 0o600)' "a new SQLite database is owner-only"
found=0
for f in data/admin-credentials.txt data/*.db .env; do
    [ -f "$f" ] || continue
    found=1
    mode="$(python3 -B -c 'import os, stat, sys; print(stat.filemode(os.stat(sys.argv[1]).st_mode))' "$f")"
    case "$mode" in
        -??-------) ok SA-10 "$f is owner-only" ;;
        *) warn SA-10 "$f is $mode (expected -rw-------)" ;;
    esac
done
[ "$found" -eq 1 ] || info SA-10 "no local runtime files here"

# ── SA-11 container hardening (replaces the bundle signature check) ─────────
section "SA-11  Container hardening"
if [ "$(grep -E '^USER ' Dockerfile | tail -n 1)" = "USER 1000:1000" ]; then
    ok SA-11 "the image runs as user 1000, not root"
else
    bad SA-11 "the last USER in the Dockerfile is not 1000:1000"
fi
if grep -qE '^ARG NODE_IMAGE=[^ ]+@sha256:[0-9a-f]{64}$' Dockerfile &&
    ! grep -E '^FROM ' Dockerfile | grep -qvE '^FROM (\$\{NODE_IMAGE\}|scratch|base)( |$)'; then
    ok SA-11 "the base image is pinned by digest and no other base is used"
else
    bad SA-11 "a base image is not pinned by digest"
fi
loose="$(grep -E '^[[:space:]]+image:' deploy/compose.yaml | grep -vE '@sha256:[0-9a-f]{64}$|\$\{APP_IMAGE' || true)"
if [ -z "$loose" ]; then ok SA-11 "every stack image is pinned"; else bad SA-11 "unpinned image in deploy/compose.yaml"; fi
none SA-11 '(image:|^FROM)[^#]*:latest' "the moving tag latest" Dockerfile deploy/compose.yaml
for line in '  read_only: true' '  cap_drop: [ALL]' 'no-new-privileges:true'; do
    need SA-11 deploy/compose.yaml "$line" "hardening: ${line#  }"
done
services="$(sed -n '/^services:$/,/^networks:$/p' deploy/compose.yaml | grep -cE '^  [a-z][a-z0-9-]*:$' || true)"
for key in mem_limit cpus pids_limit; do
    have="$(grep -cE "^    $key:" deploy/compose.yaml || true)"
    if [ "$services" -gt 0 ] && [ "$have" -eq "$services" ]; then
        ok SA-11 "all $services services set $key"
    else
        bad SA-11 "$key is set on $have of $services services"
    fi
done
if [ "$(grep -vE '^(#|$)' .dockerignore | head -n 1)" = '*' ] && grep -qxF '**/.env' .dockerignore; then
    ok SA-11 "the build context is an allow-list without env files"
else
    bad SA-11 ".dockerignore is not an allow-list that excludes env files"
fi
none SA-11 '^(ENV|ARG)[[:space:]].*(PASSWORD|SECRET|TOKEN|DATABASE_URL)' "secrets in image settings" Dockerfile

# ── SA-12 supply chain integrity (replaces release integrity) ───────────────
section "SA-12  Dependency integrity"
if python3 -B - <<'PY'
import json, sys
lock = json.load(open("package-lock.json"))
bad = [path for path, e in lock["packages"].items()
       if path and not e.get("link") and not e.get("inBundle")
       and not (e.get("resolved", "").startswith("https://registry.npmjs.org/")
                and e.get("integrity", "").startswith("sha512-"))]
if bad:
    print("  not from the registry or without sha512:", ", ".join(bad[:5]))
sys.exit(1 if bad or lock.get("lockfileVersion") != 3 else 0)
PY
then
    ok SA-12 "every locked package comes from registry.npmjs.org with a sha512 checksum"
else
    bad SA-12 "package-lock.json has a package without a registry source and checksum"
fi
loose="$(grep -hE '(^|[ ;&])npm ci( |$)' scripts/ci.sh Dockerfile .github/workflows/*.yml | grep -vE '^[[:space:]]*#' | grep -v -- '--ignore-scripts' || true)"
if [ -z "$loose" ]; then ok SA-12 "no install runs package scripts"; else bad SA-12 "npm ci without --ignore-scripts"; fi

# ── SA-13 dependency vulnerabilities ───────────────────────────────────────
section "SA-13  Dependency vulnerabilities"
if [ "$QUICK" -eq 1 ]; then
    info SA-13 "skipped (--quick)"
elif AUDIT_OUT="$(npm audit --package-lock-only --audit-level=low 2>&1)"; then
    ok SA-13 "npm audit: no known vulnerabilities in locked dependencies"
else
    bad SA-13 "npm audit reported findings or did not run: $(printf '%s\n' "$AUDIT_OUT" | tail -n 4 | tr '\n' ' ')"
fi

# ── SA-14 syntax ────────────────────────────────────────────────────────────
section "SA-14  Syntax gates"
if command -v node >/dev/null 2>&1; then
    broken=""
    for f in server/*.mjs scripts/*.mjs deploy/checks/*.mjs deploy/*.mjs public/theme-init.js; do
        node --check "$f" >/dev/null 2>&1 || broken="$broken $f"
    done
    if [ -z "$broken" ]; then ok SA-14 "JavaScript parses"; else bad SA-14 "syntax error:$broken"; fi
else
    bad SA-14 "node not available; JavaScript not checked"
fi
broken=""
for f in "${SHELL_FILES[@]}"; do
    case "$(head -n 1 "$f")" in *bash*) shell='bash' ;; *) shell='sh' ;; esac
    "$shell" -n "$f" 2>/dev/null || broken="$broken $f"
done
if [ -z "$broken" ]; then ok SA-14 "${#SHELL_FILES[@]} shell scripts parse"; else bad SA-14 "does not parse:$broken"; fi

# ── SA-16 download safety ───────────────────────────────────────────────────
section "SA-16  Download safety"
none SA-16 '^[^#]*(curl|wget)[^|#]*\|[[:space:]]*(sudo[[:space:]]+)?(ba)?sh([[:space:]]|$)' \
    "a download piped into a shell" "${SHELL_FILES[@]}" Dockerfile Jenkinsfile .github/workflows

# ── SA-17 workflow safety ───────────────────────────────────────────────────
section "SA-17  Workflows"
unpinned="$(grep -nE '^[[:space:]]*(-[[:space:]]+)?uses:' .github/workflows/*.yml | grep -vE 'uses:[[:space:]]+(\./|[^@[:space:]]+@[0-9a-f]{40}([[:space:]]|$))' | cut -d: -f1,2 | tr '\n' ' ')"
if [ -z "$unpinned" ]; then ok SA-17 "every action is pinned to a commit"; else bad SA-17 "unpinned action at $unpinned"; fi
for f in .github/workflows/*.yml; do
    grep -qE '^permissions:' "$f" || bad SA-17 "$f declares no permissions"
done
none SA-17 'pull_request_target|permissions:[[:space:]]*write-all' "privileged pull request trigger or write-all" .github/workflows

# ── summary ─────────────────────────────────────────────────────────────────
printf '\n\033[1mSummary\033[0m\n'
printf '  passed %d · warnings %d · failed %d\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
    printf '  failed checks: %s\n' "${FAILED_IDS[*]}"
    exit 1
fi
printf '  \033[32mall checks passed\033[0m\n'
exit 0
