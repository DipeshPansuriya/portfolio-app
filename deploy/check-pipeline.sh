#!/bin/sh
# Static checks of the pipeline files:
# - the Jenkinsfile runs the same gates, with the same names and order, as scripts/ci.sh;
# - the settings that must not drift or disappear.
set -eu
cd "$(dirname "$0")/.."
die() { echo "[check-pipeline] $*" >&2; exit 1; }
gates="$(sh scripts/ci.sh --list)"
stages="$(sed -n "s/^ *stage('\([1-8]\): \([^']*\)').*/\1: \2/p" Jenkinsfile)"
if [ "$gates" != "$stages" ]; then
  printf 'ci.sh gates:\n%s\nJenkinsfile stages 1-8:\n%s\n' "$gates" "$stages" >&2
  exit 1
fi
runs="$(sed -n "s/.*sh 'sh scripts\/ci.sh \([1-8]\)'.*/\1/p" Jenkinsfile | tr '\n' ' ')"
[ "$runs" = '1 2 3 4 5 6 7 8 ' ] || die "Jenkinsfile runs gates: $runs"
echo "$stages"
echo 'ok: Jenkinsfile stages 1-8 match scripts/ci.sh'

server_pg="$(sed -n 's/^ *image: \(postgres:[^ ]*\)$/\1/p' deploy/compose.yaml)"
ci_pg="$(sed -n 's/^PG_IMAGE=//p' scripts/ci.sh)"
[ -n "$server_pg" ] && [ "$server_pg" = "$ci_pg" ] ||
  die 'the PostgreSQL image differs between deploy/compose.yaml and scripts/ci.sh'
echo 'ok: one PostgreSQL image in compose.yaml and ci.sh'

# The accepted findings cover the PostgreSQL image only.
accepted=deploy/postgres-accepted.trivyignore.yaml
[ -f "$accepted" ] || die "no $accepted"
[ ! -e .trivyignore ] && [ ! -e .trivyignore.yaml ] ||
  die 'a .trivyignore in the repository root: an accept list must never reach the app scan'
[ "$(grep -v '^ *#' scripts/ci.sh | grep -c -- '--ignorefile')" = 1 ] &&
  grep -q 'trivy_scan "$workdir/pg" .*--ignorefile /scan/' scripts/ci.sh ||
  die 'ci.sh must use an ignore file exactly once, for the PostgreSQL scan'
[ "$(sed -n 's/^# image: //p' "$accepted")" = "postgres@${server_pg#*@}" ] ||
  die 'the accept list was made for another PostgreSQL digest: the owner has to accept again'
count() { grep -cE "$1" "$accepted" || true; }
ids="$(sed -n 's/^  - id: //p' "$accepted" | sort -u | wc -l | tr -d ' ')"
[ "$ids" = 46 ] && [ "$(count '^  - id: CVE-[0-9]+-[0-9]+$')" = 46 ] &&
  [ "$(count '^    expired_at: 2026-12-27$')" = 46 ] &&
  [ "$(count '^    purls: \["pkg:[^"@]+@[^"]+"\]$')" = 46 ] ||
  die 'the accept list must hold the 46 accepted ids, each with its package version and the expiry date'
echo 'ok: 46 accepted PostgreSQL findings, one image, one expiry date, no effect on the app scan'

# Nightly dump on, nothing deleted automatically.
job="$(sed -n '/^  pg-backup:$/,/^  pg-restore-test:$/p' deploy/compose.yaml)"
! echo "$job" | grep -q '^ *profiles:' || die 'the nightly dump is behind a profile (off by default)'
echo "$job" | grep -q '^ *BACKUP_PRUNE: "0"$' || die 'compose.yaml must set BACKUP_PRUNE to "0"'
echo 'ok: the nightly dump is on and deletes nothing'

loose="$(grep -hE '(^|[ ;&])npm ci( |$)' scripts/ci.sh Dockerfile | grep -vE '^ *#' | grep -v -- '--ignore-scripts' || true)"
[ -z "$loose" ] || die "npm ci without --ignore-scripts: $loose"
echo 'ok: no install runs package scripts'

root_pg="$(sed -e :a -e '/\\$/{N;s/\\\n//;ba' -e '}' scripts/ci.sh | grep 'docker run .*"\$PG_IMAGE"' | grep -v -- '--user 70:70' || true)"
[ -z "$root_pg" ] || die 'a CI PostgreSQL container does not run as user 70:70'
echo 'ok: CI PostgreSQL runs as user 70:70'

grep -q 'only main is built on this agent' Jenkinsfile || die 'the Jenkinsfile lost its main-only guard'
echo 'ok: the main-only guard is there'

# A plain --rollback after a deploy that changed nothing would start the rejected image.
! grep -q 'deploy\.sh --rollback' Jenkinsfile && grep -q 'deploy\.sh --undo "\$1"' Jenkinsfile ||
  die 'stage 11 must roll back with deploy.sh --undo "$1", never --rollback'
echo 'ok: stage 11 undoes only the switch made by this build'
