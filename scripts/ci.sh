#!/bin/sh
# Quality gates 1-8 (ADR 0004). Run from anywhere:
#   sh scripts/ci.sh              all gates
#   sh scripts/ci.sh 6 7 8        only these (the Jenkinsfile runs one per stage)
#   sh scripts/ci.sh --list       the gate names
# Needs Node, npm, git, Docker and the images below (and the Dockerfile's base) already pulled.
#   APP_IMAGE=<name:tag>  the image to build and check. Default portfolio:<git short sha>.
#   CI_OFFLINE=1          no downloads: npm uses its cache, the image build has no network,
#                         the web files come from gate 5, the cached Trivy database is used.
#   TRIVY_DB_UPDATE=1|0   refresh the Trivy database from its official source first.
#   TRIVY_CACHE_DIR       where that database lives.
set -eu
cd "$(dirname "$0")/.."

PG_IMAGE=postgres:17.11-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb
TRIVY_IMAGE=aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb
GITLEAKS_IMAGE=zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
TRIVY_DB=ghcr.io/aquasecurity/trivy-db:2
# Accepted findings of PG_IMAGE only, with their review date. Never given to the app scan.
PG_ACCEPTED=deploy/postgres-accepted.trivyignore.yaml

offline="${CI_OFFLINE:-0}"
if [ "$offline" = 1 ]; then
  export npm_config_offline=true
  TRIVY_DB_UPDATE="${TRIVY_DB_UPDATE:-0}"
fi
if [ "$(uname -s)" = Darwin ]; then default_cache="$HOME/Library/Caches/trivy"; else default_cache="$HOME/.cache/trivy"; fi
TRIVY_CACHE_DIR="${TRIVY_CACHE_DIR:-$default_cache}"

# The tests only ever see databases this script creates, never one from the caller.
unset DATABASE_URL DSH_DB_FILE TEST_DATABASE_URL

fail() { echo "[ci] $*" >&2; exit 1; }

# Only what this run created is removed.
containers=
network=
workdir=
cleanup() {
  for id in $containers; do
    docker rm -f -v "$id" >/dev/null || echo "[ci] could not remove container $id" >&2
  done
  containers=
  [ -z "$network" ] || docker network rm "$network" >/dev/null || echo "[ci] could not remove network $network" >&2
  network=
  [ -z "$workdir" ] || rm -rf "$workdir"
  workdir=
}
trap cleanup EXIT
trap 'exit 130' INT TERM

scratch() { [ -n "$workdir" ] || workdir="$(mktemp -d "${TMPDIR:-/tmp}/portfolio-ci.XXXXXX")"; }
random_hex() { node -p "require('node:crypto').randomBytes(24).toString('hex')"; }

revision() {
  sha="$(git rev-parse --short=8 HEAD 2>/dev/null)" || { echo unknown; return; }
  changed="$(git status --porcelain -- Dockerfile .dockerignore package.json package-lock.json index.html \
    'tsconfig*.json' vite.config.ts src shared public server content scripts)"
  [ -z "$changed" ] || sha="$sha-dirty"
  echo "$sha"
}

APP_IMAGE="${APP_IMAGE:-portfolio:$(revision)}"
case "${APP_IMAGE##*/}" in
  *:latest) fail "APP_IMAGE must not use the moving tag latest: $APP_IMAGE" ;;
  *:?*) ;;
  *) fail "APP_IMAGE needs an exact tag: $APP_IMAGE" ;;
esac

wait_for_postgres() { # container
  tries=0
  # Over TCP: the temporary server used during initialisation listens on a socket only.
  until docker exec "$1" pg_isready -q -h 127.0.0.1 -U postgres; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || { docker logs "$1" >&2; exit 1; }
    sleep 1
  done
}

gate1() {
  # No package script runs during the install.
  npm ci --ignore-scripts
}

gate2() {
  npm run typecheck
}

gate3() {
  npm test
}

gate4() {
  POSTGRES_PASSWORD="$(random_hex)"
  export POSTGRES_PASSWORD
  pg="portfolio-ci-pg-$$"
  containers="$containers $pg"
  # Data lives in memory (no volume, nothing from the host); the port is random and local only.
  # The password is passed by name, so it never appears in the process list.
  # User 70, as on the server: the image's entrypoint then never runs gosu.
  docker run -d --name "$pg" --pull never --user 70:70 \
    --memory 1g --cpus 1 --pids-limit 300 \
    --tmpfs /var/lib/postgresql/data:size=768m,uid=70,gid=70,mode=0700 \
    -p 127.0.0.1::5432 -e POSTGRES_PASSWORD \
    "$PG_IMAGE" -c max_connections=200 -c fsync=off -c max_wal_size=128MB >/dev/null
  wait_for_postgres "$pg"
  port="$(docker port "$pg" 5432/tcp | head -n 1 | sed 's/.*://')"
  TEST_DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@127.0.0.1:$port/postgres" npm test
  unset POSTGRES_PASSWORD
  cleanup
}

gate5() {
  npm run build
  node scripts/check-bundle.mjs
}

gate6() {
  rev="$(revision)"
  version="$(node -p "require('./package.json').version")"
  set -- --pull=false --provenance=false \
    --build-arg "VERSION=$version" --build-arg "REVISION=$rev" --build-arg "SOURCE=${SOURCE_URL:-unpublished}"
  if [ "$offline" = 1 ]; then
    [ -f dist/index.html ] && [ -f dist-server/entry.js ] || fail 'an offline image build needs gate 5 first'
    scratch
    mkdir -p "$workdir/web"
    cp -R dist dist-server "$workdir/web/"
    node deploy/offline-npm-cache.mjs "$workdir/npm"
    set -- "$@" --network none --build-context "web=$workdir/web" --build-context "npmcache=$workdir/npm" \
      --build-arg NPM_FLAGS=--offline
  fi
  docker build "$@" -t "$APP_IMAGE" .
  echo "[ci] built $APP_IMAGE"
  cleanup
}

# Scanners get their files with `docker cp`, never a mount: that works whatever
# folders Docker may share, and when this script reaches Docker through a socket.
scanner() { # <docker create arguments...>; sets $id
  id="$(docker create --pull never --memory 2g --cpus 2 --pids-limit 400 "$@")"
  containers="$containers $id"
}

scan() { # <folder copied to /scan> <docker create arguments...>, with no network
  from="$1"
  shift
  scanner --network none "$@"
  docker cp "$from/." "$id:/scan" >/dev/null
  docker start -a "$id"
}

# The only step that uses the network: the vulnerability database, official source.
trivy_db_update() {
  echo "[ci] Trivy database from $TRIVY_DB"
  scanner "$TRIVY_IMAGE" image --cache-dir /cache --download-db-only --db-repository "$TRIVY_DB" \
    --disable-telemetry --skip-version-check
  docker start -a "$id"
  docker cp "$id:/cache/db" "$TRIVY_CACHE_DIR/" >/dev/null
}

trivy_scan() { # <folder holding image.tar> <scan options...>
  from="$1"
  shift
  scanner --network none "$TRIVY_IMAGE" image --cache-dir /cache --input /scan/image.tar \
    --skip-db-update --skip-java-db-update --offline-scan --disable-telemetry --skip-version-check \
    --exit-code 1 "$@"
  docker cp "$TRIVY_CACHE_DIR/." "$id:/cache" >/dev/null
  docker cp "$from/." "$id:/scan" >/dev/null
  docker start -a "$id"
}

gate7() {
  scratch
  mkdir -p "$workdir/files" "$workdir/image" "$TRIVY_CACHE_DIR"

  echo "[ci] secret scan: files, history and settings of $APP_IMAGE"
  id="$(docker create --pull never "$APP_IMAGE")"
  containers="$containers $id"
  docker export -o "$workdir/files/rootfs.tar" "$id"
  docker image inspect "$APP_IMAGE" >"$workdir/files/config.json"
  docker history --no-trunc "$APP_IMAGE" >"$workdir/files/history.txt"
  scan "$workdir/files" "$GITLEAKS_IMAGE" dir /scan --max-archive-depth 2 --redact --no-banner

  echo '[ci] secret scan: git history'
  git clone --quiet --no-local . "$workdir/repo"
  scan "$workdir/repo" "$GITLEAKS_IMAGE" git /scan --redact --no-banner

  [ "${TRIVY_DB_UPDATE:-1}" != 1 ] || trivy_db_update
  [ -f "$TRIVY_CACHE_DIR/db/trivy.db" ] || fail "no Trivy database in $TRIVY_CACHE_DIR (run with TRIVY_DB_UPDATE=1)"

  docker save -o "$workdir/image/image.tar" "$APP_IMAGE"
  echo '[ci] Trivy: secrets'
  trivy_scan "$workdir/image" --scanners secret
  echo '[ci] Trivy: vulnerabilities, fail on HIGH or CRITICAL'
  trivy_scan "$workdir/image" --scanners vuln --severity HIGH,CRITICAL

  # A folder of its own, so the accept list is never in the app scan's container.
  mkdir "$workdir/pg"
  docker save -o "$workdir/pg/image.tar" "$PG_IMAGE"
  cp "$PG_ACCEPTED" "$workdir/pg/accepted.trivyignore.yaml"
  echo "[ci] Trivy: vulnerabilities of the PostgreSQL image, skipping only $PG_ACCEPTED"
  echo '[ci] a failure here is a new finding, or the acceptance has expired (review date 2026-12-26)'
  trivy_scan "$workdir/pg" --scanners vuln --severity HIGH,CRITICAL --ignorefile /scan/accepted.trivyignore.yaml
  cleanup
}

gate8() {
  scratch
  net="portfolio-ci-net-$$"
  pg="portfolio-ci-db-$$"
  app="portfolio-ci-app-$$"

  echo '[ci] image file listing: no .env, data folder, database or credentials file'
  id="$(docker create --pull never "$APP_IMAGE")"
  containers="$containers $id"
  docker export -o "$workdir/rootfs.tar" "$id"
  tar -tf "$workdir/rootfs.tar" >"$workdir/files.txt"
  if grep -E '(^|/)\.env($|\.)|^app/data/|^app/.*\.db($|-)|admin-credentials' "$workdir/files.txt"; then
    fail 'the image holds a file that must never be in it'
  fi
  if docker history --no-trunc --format '{{.CreatedBy}}' "$APP_IMAGE" | grep -E '(PASSWORD|SECRET|TOKEN|DATABASE_URL)='; then
    fail 'the image history holds a secret-like setting'
  fi
  echo "[ci] $(wc -l <"$workdir/files.txt" | tr -d ' ') entries checked; top of /app:"
  sed -n 's#^app/\([^/]\{1,\}\)/\{0,1\}$#  \1#p' "$workdir/files.txt"

  # A throwaway database on a network with no way out, then the app exactly as hardened.
  docker network create --internal "$net" >/dev/null
  network="$net"
  POSTGRES_PASSWORD="$(random_hex)"
  ADMIN_PASSWORD="Ci1-$(random_hex)"
  DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@$pg:5432/postgres"
  export POSTGRES_PASSWORD ADMIN_PASSWORD DATABASE_URL
  containers="$containers $pg"
  docker run -d --name "$pg" --pull never --network "$net" --user 70:70 --memory 256m --cpus 0.5 --pids-limit 100 \
    --tmpfs /var/lib/postgresql/data:size=192m,uid=70,gid=70,mode=0700 -e POSTGRES_PASSWORD "$PG_IMAGE" >/dev/null
  wait_for_postgres "$pg"
  # First in the list: the app goes before its database and network.
  containers="$app $containers"
  docker run -d --name "$app" --pull never --network "$net" \
    --read-only --tmpfs /tmp:size=16m,mode=1777 --tmpfs /run/portfolio:size=1m,uid=1000,gid=1000,mode=0700 \
    --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 0.5 --pids-limit 100 \
    -e DATABASE_URL -e ADMIN_PASSWORD -e ADMIN_EMAIL=ci@example.invalid \
    -e PUBLIC_ORIGIN=https://portfolio.invalid -e TRUST_PROXY=0 -e PG_POOL_MAX=5 \
    -e CREDENTIALS_DIR=/run/portfolio -e NODE_OPTIONS=--max-old-space-size=192 \
    "$APP_IMAGE" >/dev/null
  unset POSTGRES_PASSWORD ADMIN_PASSWORD DATABASE_URL

  tries=0
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$app")" = healthy ]; do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ] || [ "$(docker inspect -f '{{.State.Running}}' "$app")" != true ]; then
      docker logs "$app" >&2
      fail 'the container did not become healthy'
    fi
    sleep 1
  done
  uid="$(docker exec "$app" id -u)"
  [ "$uid" != 0 ] || fail 'the container runs as root'
  # Ask the mount table: the user could not write to / or /app on a writable filesystem either.
  docker exec "$app" awk '$2 == "/" { split($4, o, ","); ro = o[1] == "ro" } END { exit !ro }' /proc/mounts ||
    fail 'the root filesystem is writable'
  echo "[ci] healthy; uid $uid; $(docker inspect -f 'read-only={{.HostConfig.ReadonlyRootfs}} memory={{.HostConfig.Memory}} cap-drop={{.HostConfig.CapDrop}}' "$app")"
  docker exec -i "$app" node --input-type=module - <deploy/checks/probe.mjs
  echo '[ci] password reset inside the container'
  docker exec "$app" node scripts/reset-password.mjs ci@example.invalid
  docker exec -i "$app" node --input-type=module - <deploy/checks/after-reset.mjs
  docker logs "$app" >"$workdir/app.log" 2>&1
  if grep -E '\[shell\]|\[api\]|\[pg\]|failed to start' "$workdir/app.log"; then fail 'the app logged an error'; fi
  echo "[ci] image size: $(docker image inspect -f '{{.Size}}' "$APP_IMAGE") bytes (inspect), $(wc -c <"$workdir/rootfs.tar" | tr -d ' ') bytes unpacked files"
  cleanup
}

gate_name() {
  case "$1" in
    1) echo 'install from the lockfile' ;;
    2) echo 'typecheck' ;;
    3) echo 'tests on SQLite' ;;
    4) echo 'tests on a throwaway PostgreSQL' ;;
    5) echo 'build and bundle budget' ;;
    6) echo 'image build' ;;
    7) echo 'secret and vulnerability scan' ;;
    8) echo 'read-only run check' ;;
    *) return 1 ;;
  esac
}

all='1 2 3 4 5 6 7 8'
if [ "${1:-}" = --list ]; then
  for n in $all; do echo "$n: $(gate_name "$n")"; done
  exit 0
fi
# shellcheck disable=SC2086 # the list is meant to split
[ $# -gt 0 ] || set -- $all
selected="$*"
for n in $selected; do
  gate_name "$n" >/dev/null || fail "unknown gate: $n"
done
for n in $selected; do
  printf '\n[ci] gate %s: %s\n' "$n" "$(gate_name "$n")"
  "gate$n"
done
printf '\n[ci] gates %s passed (image %s)\n' "$selected" "$APP_IMAGE"
