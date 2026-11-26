#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# install_hooks.sh — activate the repository's git hooks.
#
#   ./scripts/install_hooks.sh            install, or refresh the saved copies
#   ./scripts/install_hooks.sh --check    report status without changing anything
#   ./scripts/install_hooks.sh --remove   take the hooks out again
#
# The hooks are version-controlled in .githooks/. Git runs a small starter from its
# own hooks folder (.git/hooks), which no checkout changes: it runs the checked-out
# .githooks/ file, or on a branch without one the copy saved at install time.
# Every clone gets the same rules after running this once.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT" || exit 1

HOOKS="pre-commit pre-push"
MARKER="portfolio-hooks: written by scripts/install_hooks.sh"
MODE="${1:-install}"

common="$(git rev-parse --git-common-dir)" || exit 1
TARGET="$(cd "$common" && pwd)/hooks"
SAVED="$TARGET/saved"

ours() { grep -qF -- "$MARKER" "$1" 2>/dev/null; }

starter() {
    printf '#!/bin/bash\n# %s. Do not edit.\n' "$MARKER"
    cat <<'STARTER'
# Runs the checked-out branch's hook, or the saved copy on a branch without one.
name="$(basename "$0")"
root="$(git rev-parse --show-toplevel)" || exit 1
hook="$root/.githooks/$name"
[ -f "$hook" ] || hook="$(cd "$(dirname "$0")" && pwd)/saved/$name"
exec bash "$hook" "$@"
STARTER
}

case "$MODE" in
    --check)
        current="$(git config --get core.hooksPath || true)"
        if [ -n "$current" ] && [ "$current" != "$TARGET" ]; then
            if [ "$current" = .githooks ]; then
                echo "hooks: old setup (core.hooksPath=.githooks): no hooks on a branch without that folder"
            else
                echo "hooks: NOT active (core.hooksPath=$current)"
            fi
            echo "       run ./scripts/install_hooks.sh"
            exit 1
        fi
        for h in $HOOKS; do
            if [ -x "$TARGET/$h" ] && ours "$TARGET/$h" && [ -f "$SAVED/$h" ]; then
                echo "  $h: active"
            else
                echo "hooks: NOT active ($h is not installed)"
                echo "       run ./scripts/install_hooks.sh to enable"
                exit 1
            fi
        done
        [ -f "$SAVED/check_secrets.py" ] || { echo "hooks: NOT active (no saved scanner)"; exit 1; }
        for pair in .githooks/pre-commit:pre-commit .githooks/pre-push:pre-push scripts/check_secrets.py:check_secrets.py; do
            [ ! -f "${pair%:*}" ] || cmp -s "${pair%:*}" "$SAVED/${pair#*:}" ||
                echo "  note: the saved copy of ${pair%:*} differs; run the installer again to refresh it"
        done
        echo "hooks: active"
        exit 0
        ;;
    --remove)
        for h in $HOOKS; do
            ! ours "$TARGET/$h" || rm -f "$TARGET/$h"
            rm -f "$SAVED/$h"
        done
        rm -f "$SAVED/check_secrets.py"
        rmdir "$SAVED" 2>/dev/null || true
        git config --local --unset-all core.hooksPath 2>/dev/null || true
        echo "hooks: removed"
        exit 0
        ;;
    install) ;;
    *)
        echo "usage: $0 [--check|--remove]" >&2
        exit 2
        ;;
esac

# Check everything first, so a refusal changes nothing.
for h in $HOOKS; do
    if [ -e "$TARGET/$h" ] && ! ours "$TARGET/$h"; then
        echo "hooks: $TARGET/$h exists and was not written by this script; move it first" >&2
        exit 1
    fi
done

fail() { echo "hooks: install failed: $*" >&2; exit 1; }
mkdir -p "$SAVED" || fail "cannot create $SAVED"
chmod +x .githooks/pre-commit .githooks/pre-push scripts/check_secrets.py || fail "chmod"
cp scripts/check_secrets.py "$SAVED/check_secrets.py" || fail "cannot save the scanner"
for h in $HOOKS; do
    cp ".githooks/$h" "$SAVED/$h" || fail "cannot save $h"
    starter >"$TARGET/$h" || fail "cannot write $h"
    chmod +x "$TARGET/$h" || fail "chmod $h"
done

# Git's own hooks folder is the default. A setting of ours (older versions used
# .githooks) is removed; one from the user's global settings is overridden here.
git config --local --unset-all core.hooksPath 2>/dev/null || true
if [ -n "$(git config --get core.hooksPath || true)" ]; then
    git config --local core.hooksPath "$TARGET" || fail "cannot set core.hooksPath"
fi

echo "hooks: installed in $TARGET"
echo "  pre-commit     → scripts/check_secrets.py --staged, then syntax gates"
echo "  pre-push       → scripts/check_secrets.py --range and the committed HEAD tree"
echo
echo "verify with: ./scripts/install_hooks.sh --check"
