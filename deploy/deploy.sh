#!/bin/sh
# Deploy one image, or go back to the one before (ADR 0004). Runs next to compose.yaml.
#   sh deploy.sh <name:tag | tag>   a bare tag keeps the current image name
#   sh deploy.sh --rollback         redeploy the previous image
#   sh deploy.sh --undo <name:tag>  the same, only if the last deploy switched to that image
#                                   (pipeline stage 11); a failed undo can be run again
# Order: dump the database, start the new image, check it. If it fails, the current image
# is started again. State: release.env (current), previous.env, switched.env (set when the
# last deploy changed the image), releases.log.
# The dump leaves a released database exactly as it runs: new database settings apply only
# after it. A rollback never repeats the public URL check (PUBLIC_CHECK): when the public
# address is what fails, the older image would "fail" too.
#   COMPOSE_PROJECT  default portfolio     COMPOSE_EXTRA  one more compose file
#   WAIT_SECONDS     time to become healthy, default 90
# A rollback changes the app image only. It never restores the database.
set -eu
umask 077
cd "$(dirname "$0")"
PROJECT="${COMPOSE_PROJECT:-portfolio}"
WAIT="${WAIT_SECONDS:-90}"
export COMPOSE_PROJECT="$PROJECT"
# Only the files here decide these, never the caller's shell.
unset APP_IMAGE DATABASE_URL DB_PASSWORD BACKUP_DB_PASSWORD POSTGRES_PASSWORD ADMIN_PASSWORD COMPOSE_FILE

say() { echo "[deploy] $*"; }
die() { echo "[deploy] $*" >&2; exit 1; }
image_in() { [ ! -f "$1" ] || sed -n 's/^APP_IMAGE=//p' "$1" | tail -n 1; }

compose_as() { # <image> <compose arguments...>
  image="$1"
  shift
  APP_IMAGE="$image" docker compose -p "$PROJECT" -f compose.yaml ${COMPOSE_EXTRA:+-f "$COMPOSE_EXTRA"} \
    --env-file .env "$@"
}

record() { # <result> <image>
  id="$(docker image inspect -f '{{.Id}}' "$2" 2>/dev/null || echo unknown)"
  echo "$(date -u +%FT%TZ) $1 image=$2 id=$id volumes=$PROJECT-pg-data,$PROJECT-pg-backups project=$PROJECT" >>releases.log
}

activate() { # <image>; the app and, through depends_on, the database
  compose_as "$1" up -d --wait --wait-timeout "$WAIT" --no-build --pull missing app &&
    sh post-deploy-check.sh "$1"
}

# The nightly job starts after the app and is not waited for: its health must never roll
# the app back. It is recreated so that it runs the copied scripts.
backup_job() { # <image>
  compose_as "$1" up -d --no-deps --force-recreate --no-build --pull missing pg-backup ||
    say 'WARNING: the nightly dump job did not start' >&2
}

inside_only() {
  PUBLIC_CHECK=0
  export PUBLIC_CHECK
  say 'rolling back: checked inside the stack only; check the public address separately'
}

usage='usage: deploy.sh <name:tag | tag> | --rollback | --undo <name:tag>'
current="$(image_in release.env)"
undo=
if [ "${1:-}" = --undo ]; then
  [ $# -eq 2 ] || die "$usage"
  # After a deploy that changed nothing, previous.env may hold an image that was rejected.
  [ "$2" = "$current" ] && [ "$2" = "$(image_in switched.env)" ] ||
    die "the last deploy did not switch to $2: nothing rolled back (current: ${current:-none})"
  undo=1
  set -- --rollback
fi
[ $# -eq 1 ] || die "$usage"
[ -f .env ] || die 'no .env here (bootstrap-env.sh writes it)'
rollback=
case "$1" in
  --rollback)
    rollback=1
    target="$(image_in previous.env)"
    [ -n "$target" ] || die 'no previous image is recorded'
    inside_only
    ;;
  */* | *:*) target="$1" ;;
  *)
    [ -n "$current" ] || die 'the first deploy needs the full image name'
    name="${current%@*}"
    case "${name##*/}" in *:*) name="${name%:*}" ;; esac
    target="$name:$1"
    ;;
esac
case "$target" in
  *[!A-Za-z0-9._/:@-]* | -*) die "unexpected character in the image name: $target" ;;
esac
case "${target##*/}" in
  *:latest) die 'the moving tag latest is not allowed' ;;
  *:?*) ;;
  *) die "the image needs an exact tag or digest: $target" ;;
esac

mkdir .deploy.lock 2>/dev/null || die 'another deploy is running (or remove the folder .deploy.lock)'
trap 'rmdir .deploy.lock' EXIT
trap 'exit 130' INT TERM
# A deploy or manual rollback voids the last switch at once. An undo keeps it until a
# release succeeds, so one that failed (pull, dump, checks) can be run again.
[ -n "$undo" ] || rm -f switched.env

docker image inspect "$target" >/dev/null 2>&1 || docker pull "$target" || die "cannot get $target; nothing changed"

# Dump before anything changes. Only a first deploy has no database to dump.
if [ -n "$current" ] || docker volume inspect "$PROJECT-pg-data" >/dev/null 2>&1; then
  say 'dumping the database first'
  # Released: start a stopped database as it is, never recreate it here. Nothing released
  # yet: a corrected setting may replace it, and a database without tables is not an error.
  keep=--no-recreate
  empty_ok=0
  if [ -z "$current" ]; then
    keep=
    empty_ok=1
  fi
  # shellcheck disable=SC2086 # one word or none
  compose_as "${current:-$target}" up -d $keep --wait --wait-timeout "$WAIT" --no-build --pull missing postgres ||
    die 'the database did not become healthy; nothing was deployed'
  compose_as "${current:-$target}" run --rm -T --no-deps -e RUN_ONCE=1 -e "SKIP_IF_EMPTY=$empty_ok" pg-backup ||
    die 'the dump failed; nothing was deployed'
fi

say "deploying $target (current: ${current:-none})"
if activate "$target"; then
  rm -f switched.env
  echo "APP_IMAGE=$target" >release.env
  if [ -n "$current" ] && [ "$current" != "$target" ]; then
    echo "APP_IMAGE=$current" >previous.env
    [ -n "$rollback" ] || echo "APP_IMAGE=$target" >switched.env
  fi
  record deployed "$target"
  backup_job "$target"
  say "done: $target (previous: $(image_in previous.env))"
  exit 0
fi

record failed "$target"
compose_as "$target" logs --no-color --tail 30 app >&2 || true
if [ -n "$current" ] && [ "$current" != "$target" ]; then
  say "FAILED: going back to $current" >&2
  inside_only
  if activate "$current"; then
    record rolled-back "$current"
    backup_job "$current"
    die "$target failed; $current is running again"
  fi
  record rollback-failed "$current"
  die "ROLLBACK FAILED: neither $target nor $current passes the checks"
fi
[ -z "$current" ] || die "$target failed again; it is the current image, so there is nothing to switch to"
compose_as "$target" stop app >&2 || true
die "$target failed and there is no earlier image; the app is stopped"
