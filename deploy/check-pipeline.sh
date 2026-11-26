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

# One volume. The shared-database file adds none, and no database service or image.
for file in deploy/compose.yaml deploy/compose.local.yaml; do
  keys="$(sed -n '/^volumes:$/,$p' "$file" | grep -E '^  [A-Za-z0-9_-]+:' | sed 's/:.*//' | tr -d ' ' | tr '\n' ' ')"
  [ "$keys" = 'data ' ] || die "$file must declare the one volume 'data', not: $keys"
done
shared=deploy/compose.shared-db.yaml
! grep -qE '^volumes:|^ +image:' "$shared" && grep -q '^  postgres: !reset null$' "$shared" ||
  die "$shared must remove the database service and add no volume or image"
grep -q ' compose.shared-db.yaml ' Jenkinsfile || die 'stage 10 does not copy compose.shared-db.yaml'
echo 'ok: one volume; the shared-database file has no database service of its own'

# scripts/ci.sh names the app image; Jenkins asks it, a server records it in release.env.
repo="$(sed -n 's/^IMAGE_REPO=//p' scripts/ci.sh)"
[ -n "$repo" ] && [ "$(grep -c '^IMAGE_REPO=' scripts/ci.sh)" = 1 ] || die 'scripts/ci.sh must set IMAGE_REPO once'
elsewhere="$(grep -lF "$repo" Jenkinsfile Dockerfile deploy/*.yaml deploy/*.sh .github/workflows/*.yml || true)"
[ -z "$elsewhere" ] || die "the image name is repeated in: $elsewhere"
grep -q "script: 'sh scripts/ci.sh --image'" Jenkinsfile || die 'the Jenkinsfile must take the image name from ci.sh'
echo "ok: the image name $repo is defined in scripts/ci.sh only"

# Clean-up removes named tags only.
! grep -v '^ *#' scripts/ci.sh | grep -qE 'prune|docker (image rm|rmi) [^|]*(-f|--force)' ||
  die 'ci.sh must never prune or force an image removal'
unlimited="$(grep -E 'docker run ' Jenkinsfile | grep -vE -e '--memory .*--cpus ' || true)"
[ -z "$unlimited" ] || die "a Jenkins container without memory and CPU limits: $unlimited"
echo 'ok: no prune, no forced removal; Jenkins containers are limited'

loose="$(grep -hE '(^|[ ;&])npm ci( |$)' scripts/ci.sh Dockerfile | grep -vE '^ *#' | grep -v -- '--ignore-scripts' || true)"
[ -z "$loose" ] || die "npm ci without --ignore-scripts: $loose"
echo 'ok: no install runs package scripts'

root_pg="$(sed -e :a -e '/\\$/{N;s/\\\n//;ba' -e '}' scripts/ci.sh | grep 'docker run .*"\$PG_IMAGE"' | grep -v -- '--user 70:70' || true)"
[ -z "$root_pg" ] || die 'a CI PostgreSQL container does not run as user 70:70'
echo 'ok: CI PostgreSQL runs as user 70:70'

# The Docker socket of the production host is on one agent only (gate finding 1).
block() { sed -n "/stage('$1')/,$2p" Jenkinsfile; }
build="$(sed -n "/stage('build and verify')/,/stage('release')/p" Jenkinsfile)"
release="$(block release '$')"
grep -q '^    agent none$' Jenkinsfile && ! grep -q 'agent any' Jenkinsfile ||
  die 'the pipeline must have no default agent'
# Pipeline-level skipDefaultCheckout() must be present (prevents implicit checkout before prepare).
grep -q '^        skipDefaultCheckout()$' Jenkinsfile ||
  die 'pipeline must have skipDefaultCheckout() in options'
echo "$build" | grep -q "agent { label 'portfolio-build' }" || die 'gates 1-8 must run on portfolio-build'
! echo "$build" | grep -qE 'docker\.sock|/docker/portfolio|withCredentials' ||
  die 'the build agent part reaches the production socket, folder or a credential'
echo "$release" | grep -q "agent { label 'portfolio-deploy' }" &&
  echo "$release" | grep -q 'skipDefaultCheckout()' &&
  echo "$release" | grep -q "unstash 'release-files'" &&
  [ "$(grep -n "stash name: 'release-files'" Jenkinsfile | cut -d: -f1)" -lt "$(grep -n "sh 'sh scripts/ci.sh 1'" Jenkinsfile | cut -d: -f1)" ] &&
  [ "$(grep -n "stash name: 'release-files'" Jenkinsfile | cut -d: -f1)" -lt "$(grep -n "sh 'sh deploy/check-pipeline.sh'" Jenkinsfile | cut -d: -f1)" ] ||
  die 'the release part must run on portfolio-deploy from the stashed files, after approval'
[ "$(grep -cE "agent \{" Jenkinsfile)" = 2 ] || die 'there must be exactly two agents'
echo 'ok: gates run without the production socket; the deploy agent builds nothing'

# The prepare stage must clean the workspace before checkout, so nothing from an
# old build reaches the stash.
prepare="$(sed -n "/stage('prepare')/,/stage('1: install from the lockfile')/p" Jenkinsfile)"
# Remove /* */ block comments (including multi-line) before checking.
prepare_nocomment=$(echo "$prepare" | sed '/\/\*/,/\*\//d')
# Reject any commented-out deleteDir() (//, #, or remaining /* */).
echo "$prepare_nocomment" | grep -Eq '^[[:space:]]*//[[:space:]]*deleteDir\(\)' && die "prepare has commented-out deleteDir()"
echo "$prepare_nocomment" | grep -Eq '^[[:space:]]*#[[:space:]]*deleteDir\(\)' && die "prepare has commented-out deleteDir()"
echo "$prepare_nocomment" | grep -Eq '/\*[[:space:]]*deleteDir\(\)[[:space:]]*\*/' && die "prepare has commented-out deleteDir()"
# Require a line that is exactly deleteDir() (with optional leading spaces).
echo "$prepare_nocomment" | grep -Eq '^[[:space:]]*deleteDir\(\)[[:space:]]*$' || die "prepare must have a line exactly 'deleteDir()'"
# deleteDir() must be before checkout(scm): find the line numbers.
delete_line=$(echo "$prepare_nocomment" | grep -n '^[[:space:]]*deleteDir()' | head -n 1 | cut -d: -f1)
checkout_line=$(echo "$prepare_nocomment" | grep -n 'checkout(scm)' | head -n 1 | cut -d: -f1)
[ -n "$delete_line" ] && [ -n "$checkout_line" ] && [ "$delete_line" -lt "$checkout_line" ] ||
  die "prepare must call deleteDir() before checkout(scm)"
echo 'ok: prepare cleans the workspace before checkout'

# The approval: one input, before the deploy agent, restricted to a controller setting that
# must be there (an empty submitter would let anyone with build rights approve). It is a
# stage inside `release`, so a restart from that stage asks again.
line() { grep -nF -- "$1" Jenkinsfile | head -n 1 | cut -d: -f1; }
approval="$(sed -n "/stage('approval')/,/agent { label 'portfolio-deploy' }/p" Jenkinsfile)"
[ "$(grep -cE '^ *input([ ({]|$)' Jenkinsfile)" = 1 ] &&
  [ -n "$(line "stage('approval')")" ] &&
  [ "$(line "stage('release')")" -lt "$(line "stage('approval')")" ] &&
  [ "$(line "stage('approval')")" -lt "$(line "agent { label 'portfolio-deploy' }")" ] &&
  echo "$approval" | grep -qF "def approver = env.DEPLOY_APPROVER ?: ''" &&
  echo "$approval" | grep -qF 'if (!(approver ==~ /[A-Za-z0-9._@-]+(,[A-Za-z0-9._@-]+)*/)) {' &&
  echo "$approval" | grep -qF 'error ' && echo "$approval" | grep -qE '^ *input .*submitter: approver$' &&
  ! grep -qE 'DEPLOY_APPROVER *=([^=~]|$)' Jenkinsfile ||
  die 'the approval must name its submitter from DEPLOY_APPROVER and stop without it'
echo 'ok: only the named approver releases; no name, no release'

# The release image: its ID is kept by the controller straight after gate 8, and the deploy
# agent loads the archive through load-release.sh only (finding R1).
! grep -v '^ *//' Jenkinsfile | grep -qE 'docker (image )?(load|import)' ||
  die 'the Jenkinsfile loads an archive without load-release.sh'
echo "$release" | grep -qF "sh 'sh deploy/load-release.sh release-image.tar \"\$APP_IMAGE\" \"\$APP_IMAGE_ID\"'" ||
  die 'stage 9 must load the archive with load-release.sh, the name and the recorded ID'
record="env.APP_IMAGE_ID = readFile('release-image.id').trim()"
grep -q "^        IMAGE_ID_FILE = 'release-image.id'$" Jenkinsfile &&
  [ "$(grep -c 'APP_IMAGE_ID *=' Jenkinsfile)" = 1 ] && [ -n "$(line "$record")" ] &&
  [ "$(line "sh 'sh scripts/ci.sh 8'")" -lt "$(line "$record")" ] &&
  [ "$(line "$record")" -lt "$(line "stage('hand over the release')")" ] &&
  grep -qF 'echo "$tested" >"$IMAGE_ID_FILE"' scripts/ci.sh ||
  die 'the image ID of gate 8 must be recorded straight after it'
echo 'ok: the deploy agent loads only the recorded image'

# The proxy the app trusts must be named: without a list it trusts every private peer.
grep -qF 'TRUSTED_PROXY_IPS: ${TRUSTED_PROXY_IPS:?' deploy/compose.yaml ||
  die 'compose.yaml must require TRUSTED_PROXY_IPS'
echo 'ok: the trusted proxy is required'

# Containers next to the socket and the scanners are not root.
helpers="$(sed -e :a -e '/\\$/{N;s/\\\n//;ba' -e '}' Jenkinsfile | grep 'docker run ')"
[ -n "$helpers" ] && ! echo "$helpers" | grep -v -e '--user "\$DEPLOY_USER" .*--cap-drop ALL' | grep -q . ||
  die 'a Jenkins helper container may run as root or keeps capabilities'
grep -qF 'case "${DEPLOY_USER:-}" in' Jenkinsfile || die 'DEPLOY_USER is not checked'
grep -q "^        CI_KEEP_REQUIRED = '1'$" Jenkinsfile || die 'the pipeline must require a keep list before removing images'
grep -q -- '--user "$SCAN_USER" --cap-drop ALL --security-opt no-new-privileges' scripts/ci.sh ||
  die 'the scanner containers may run as root'
echo 'ok: no root helper or scanner container'

# Requests and limits on every container.
services="$(sed -n '/^services:$/,/^networks:$/p' deploy/compose.yaml | grep -cE '^  [a-z-]+:$')"
for key in cpus cpu_shares mem_limit mem_reservation; do
  [ "$(grep -cE "^    $key: " deploy/compose.yaml)" = "$services" ] || die "a compose service without $key"
done
for file in Jenkinsfile scripts/ci.sh deploy/rehearse.sh deploy/rehearse-shared.sh; do
  for flag in '--memory ' '--memory-reservation ' '--cpus ' '--cpu-shares '; do
    ! sed -e :a -e '/\\$/{N;s/\\\n//;ba' -e '}' "$file" |
      grep -E '(docker run |docker create --pull never --)' | grep -v '^ *#' |
      grep -v -- "$flag" | grep -q . || die "$file: a container without $flag"
  done
done
echo "ok: CPU and memory requests and limits on all $services services and the helper containers"

# The shared-volume file: an existing volume, never created or re-owned.
volume=deploy/compose.shared-volume.yaml
grep -q '^    external: true$' "$volume" && grep -qF 'name: ${DATA_VOLUME:?' "$volume" &&
  grep -q ' compose.shared-volume.yaml ' Jenkinsfile || die "$volume must use an existing volume and be copied by stage 10"
! grep -v '^ *#' deploy/compose.yaml "$volume" | grep -qE 'chmod [0-7]+ /var/lib/postgresql/data([^/]|$)|chown' ||
  die 'a permission change on the volume root'
echo 'ok: an existing volume can be reused; its root is not changed'

# The public host comes from .env; www is redirected to it, with its own certificate.
for label in 'routers.portfolio-www.rule: Host(`www.${PORTFOLIO_HOST}`)' \
  'routers.portfolio-www.tls.certresolver: letsencrypt' \
  'routers.portfolio-www.middlewares: portfolio-www' \
  'middlewares.portfolio-www.redirectregex.replacement: https://${PORTFOLIO_HOST}/$${1}' \
  'middlewares.portfolio-www.redirectregex.permanent: "true"'; do
  grep -qF "traefik.http.$label" deploy/compose.yaml || die "compose.yaml lacks the label traefik.http.$label"
done
echo 'ok: www redirects to the configured host'

grep -q 'only main is built on this agent' Jenkinsfile || die 'the Jenkinsfile lost its main-only guard'
echo 'ok: the main-only guard is there'

# A plain --rollback after a deploy that changed nothing would start the rejected image.
! grep -q 'deploy\.sh --rollback' Jenkinsfile && grep -q 'deploy\.sh --undo "\$1"' Jenkinsfile ||
  die 'stage 11 must roll back with deploy.sh --undo "$1", never --rollback'
echo 'ok: stage 11 undoes only the switch made by this build'
