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
# .env must name the reverse proxy in TRUSTED_PROXY_IPS.
# Own database: it must be on the volume of the last release (releases.log), else nothing is
# started. After a copy to another volume: DATA_MOVED_TO=<that volume> (README, "Moving the
# database to another volume").
#   WAIT_SECONDS     time to become healthy, default 90
# The compose files come from COMPOSE_FILE in .env (default compose.yaml: own PostgreSQL;
# with compose.shared-db.yaml there is no database service to start).
# A rollback changes the app image only. It never restores the database.
set -eu
umask 077
cd "$(dirname "$0")"
PROJECT="${COMPOSE_PROJECT:-portfolio}"
WAIT="${WAIT_SECONDS:-90}"
export COMPOSE_PROJECT="$PROJECT"
# Only the files here decide these, never the caller's shell.
unset APP_IMAGE DATABASE_URL DB_PASSWORD BACKUP_DB_PASSWORD POSTGRES_PASSWORD ADMIN_PASSWORD COMPOSE_FILE \
  DATA_VOLUME DB_HOST DB_PORT DB_NETWORK TRUSTED_PROXY_IPS

say() { echo "[deploy] $*"; }
die() { echo "[deploy] $*" >&2; exit 1; }
image_in() { [ ! -f "$1" ] || sed -n 's/^APP_IMAGE=//p' "$1" | tail -n 1; }
setting() { sed -n "s/^$1=//p" .env | tail -n 1; }

released_database() { # "<own|shared> <volume>" of the last release that worked, else nothing
  [ ! -f releases.log ] || sed -n \
    -e 's/^[^ ]* deployed .* volume=\([^ ]*\) database=\([^ ]*\) .*/\2 \1/p' \
    -e 's/^[^ ]* rolled-back .* volume=\([^ ]*\) database=\([^ ]*\) .*/\2 \1/p' releases.log | tail -n 1
}

compose_as() { # <image> <compose arguments...>
  image="$1"
  shift
  APP_IMAGE="$image" COMPOSE_FILE="$files" docker compose -p "$PROJECT" --env-file .env "$@"
}

record() { # <result> <image>
  id="$(docker image inspect -f '{{.Id}}' "$2" 2>/dev/null || echo unknown)"
  # The registry digest (name@sha256:...); `none` for an image that has none.
  digest="$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$2" 2>/dev/null | head -n 1)" || digest=
  echo "$(date -u +%FT%TZ) $1 image=$2 id=$id digest=${digest:-none} volume=$volume database=$database project=$PROJECT" >>releases.log
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
# The app trusts X-Forwarded-For from these peers only. Without a list it trusts every
# private peer, so any container on its networks could forge the visitor's address.
proxies="$(setting TRUSTED_PROXY_IPS)"
need='TRUSTED_PROXY_IPS in .env must list the reverse proxy: an address, or a subnet of /16 (IPv6 /64) or narrower; commas between, no quotes; nothing changed'
case "$proxies" in *[!0-9A-Fa-f.:/,\ ]*) die "$need" ;; esac
entries=0
# Only digits, hex letters and . : / are left, so nothing here can match a file name.
for entry in $(printf '%s' "$proxies" | tr ',' ' '); do
  printf '%s\n' "$entry" | grep -qxE \
    '([0-9]{1,3}\.){3}[0-9]{1,3}(/(1[6-9]|2[0-9]|3[0-2]))?|[0-9A-Fa-f]*:[0-9A-Fa-f:]*:[0-9A-Fa-f]*(/(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-8]))?' ||
    die "$need"
  entries=$((entries + 1))
done
[ "$entries" -gt 0 ] || die "$need"
files="$(sed -n 's/^COMPOSE_FILE=//p' .env | tail -n 1)"
files="${files:-compose.yaml}"
case ":$files:" in
  *:compose.shared-db.yaml:*) database=shared ;;
  *) database=own ;;
esac
files="$files${COMPOSE_EXTRA:+:$COMPOSE_EXTRA}"
# An existing volume (compose.shared-volume.yaml), else the project's own.
volume="$(setting DATA_VOLUME)"
case ":$files:" in
  *:compose.shared-volume.yaml:*) ;;
  *) [ -z "$volume" ] ||
    die 'DATA_VOLUME is set but COMPOSE_FILE lacks compose.shared-volume.yaml; nothing changed' ;;
esac
volume="${volume:-$PROJECT-data}"
if [ "$database" = shared ]; then
  # The app and the dump jobs must use the same server, or the dumps miss the live data.
  # Names only in the messages: DATABASE_URL holds a password.
  url="$(setting DATABASE_URL)"
  url="${url##*@}"
  url="${url%%\?*}"
  server="${url%%/*}"
  case "$server" in *:*) ;; *) server="$server:5432" ;; esac
  port="$(setting DB_PORT)"
  [ "$server/${url#*/}" = "$(setting DB_HOST):${port:-5432}/portfolio" ] ||
    die 'DATABASE_URL must point to DB_HOST, DB_PORT (default 5432) and the database portfolio; nothing changed'
  own="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" \
    --filter label=com.docker.compose.service=postgres)"
  [ -z "$own" ] ||
    die 'this server still has its own database container: moving to a shared database is done by hand (README, "From an own database to a shared one"); nothing changed'
fi
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

# A database started on another volume is a new, empty one: the site would come up without its
# content, and new edits would go there. Only a stated move changes the volume.
moved=
if [ "$database" = own ] && [ -n "$current" ]; then
  was="$(released_database)"
  if [ -n "$was" ] && [ "$was" != "own $volume" ]; then
    [ "${DATA_MOVED_TO:-}" = "$volume" ] ||
      die "the last release used database '$was' (kind, volume); these settings use 'own $volume'. Nothing changed (README, \"Moving the database to another volume\")"
    running="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
      --filter label=com.docker.compose.service=postgres)"
    [ -z "$running" ] || die 'stop the app and the database before moving to another volume; nothing changed'
    moved=1
  fi
fi

mkdir .deploy.lock 2>/dev/null || die 'another deploy is running (or remove the folder .deploy.lock)'
trap 'rmdir .deploy.lock' EXIT
trap 'exit 130' INT TERM
# A deploy or manual rollback voids the last switch at once. An undo keeps it until a
# release succeeds, so one that failed (pull, dump, checks) can be run again.
[ -n "$undo" ] || rm -f switched.env

docker image inspect "$target" >/dev/null 2>&1 || docker pull "$target" || die "cannot get $target; nothing changed"
arch="$(docker image inspect -f '{{.Architecture}}' "$target")" || arch=
server_arch="$(docker version -f '{{.Server.Arch}}')" || server_arch=
[ -n "$arch" ] && [ "$arch" = "$server_arch" ] ||
  die "$target is built for ${arch:-an unknown processor}, this server is ${server_arch:-unknown}; nothing changed"

# The compose files with these settings are checked before anything is touched.
compose_as "$target" config -q || die 'the compose files or their settings are not valid; nothing changed'

# A released own database must be in the volume, before anything makes a volume or a folder.
if [ "$database" = own ] && [ -n "$current" ]; then
  docker volume inspect "$volume" >/dev/null 2>&1 ||
    die "no volume $volume: the released database is not there; nothing changed"
  compose_as "$current" run --rm -T --no-deps --entrypoint sh pg-folders \
    -c 'test -s /var/lib/postgresql/data/portfolio/pgdata/PG_VERSION' ||
    die "no database found in volume $volume (portfolio/pgdata); nothing changed"
fi

# Dump before anything changes. Only a first deploy of an own database has none to dump;
# a shared one exists before the first deploy.
dump=
if [ "$database" = shared ] || [ -n "$current" ] || docker volume inspect "$volume" >/dev/null 2>&1; then
  dump=1
fi
# portfolio/ and its dumps folder exist before any service mounts them.
compose_as "${current:-$target}" run --rm -T --no-deps pg-folders ||
  die 'the folders in the volume could not be made; nothing was deployed'
if [ -n "$dump" ]; then
  say 'dumping the database first'
  # Released: start a stopped database as it is, never recreate it here. Nothing released
  # yet: a corrected setting may replace it, and a database without tables is not an error.
  keep=--no-recreate
  empty_ok=0
  if [ -z "$current" ]; then
    keep=
    empty_ok=1
  fi
  # After a move the database starts on the new volume, and the strict dump reads the copy.
  [ -z "$moved" ] || keep=
  if [ "$database" = own ]; then
    # shellcheck disable=SC2086 # one word or none
    compose_as "${current:-$target}" up -d $keep --wait --wait-timeout "$WAIT" --no-build --pull missing postgres ||
      die 'the database did not become healthy; nothing was deployed'
  fi
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
