#!/bin/sh
# Local proof of the shared-database path (compose.shared-db.yaml), with throwaway secrets.
#   sh deploy/rehearse-shared.sh <image A> <image B>     both already built (same name, two tags)
# A stand-in "shared server" (the pinned PostgreSQL, data in memory, on a private network,
# with another application's database) plays the VPS's shared PostgreSQL. It creates its own
# server, network, compose project and ONE volume, and removes only those.
set -eu
cd "$(dirname "$0")"
[ $# -eq 2 ] || { echo 'usage: rehearse-shared.sh <image A> <image B>' >&2; exit 2; }
A="$1"
B="$2"
PG_IMAGE="$(sed -n 's/^ *image: \(postgres:[^ ]*\)$/\1/p' compose.yaml)"
[ -n "$PG_IMAGE" ] || { echo 'no PostgreSQL image in compose.yaml' >&2; exit 1; }
PROJECT="portfolio-rehearsal-shared-$$"
SERVER="$PROJECT-server"
DBNET="$PROJECT-dbnet"
# A stand-in for the server's existing shared volume (compose.shared-volume.yaml).
VOLUME="$PROJECT-vps"
DUMPS=/var/lib/postgresql/data/portfolio/backups
FILES=compose.yaml:compose.shared-volume.yaml:compose.shared-db.yaml:compose.local-shared.yaml
work="$(mktemp -d "${TMPDIR:-/tmp}/portfolio-rehearsal.XXXXXX")"
export COMPOSE_PROJECT="$PROJECT" COMPOSE_EXTRA=compose.local-shared.yaml

step() { printf '\n[shared] %s\n' "$*"; }
die() { echo "[shared] FAILED: $*" >&2; exit 1; }
current() { sed -n 's/^APP_IMAGE=//p' "$work/release.env"; }
compose() {
  (cd "$work" && APP_IMAGE="$(current)" COMPOSE_PROJECT_NAME="$PROJECT" COMPOSE_FILE="$FILES" \
    docker compose -p "$PROJECT" --env-file .env "$@")
}
running_image() { docker inspect -f '{{.Config.Image}}' "$(compose ps -q app)"; }
content() { # save|expect <marker>
  compose exec -T -e "MODE=$1" -e "MARK=$2" app node --input-type=module - <checks/content.mjs
}
deploy() { sh "$work/deploy.sh" "$@"; }
server_sql() { # <database> <sql>, as the server's administrator
  docker exec "$SERVER" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -XqtAc "$2"
}
as_role() { # <role> <database> <sql>, over the network from a dump job, with that role's password
  name=BACKUP_DB_PASSWORD
  [ "$1" != portfolio_app ] || name=DB_PASSWORD
  (
    PGPASSWORD="$(sed -n "s/^$name=//p" "$work/.env")"
    export PGPASSWORD
    compose run --rm -T -e "PGUSER=$1" -e PGPASSWORD --entrypoint psql pg-backup -d "$2" -v ON_ERROR_STOP=1 -XqtAc "$3"
  )
}

# The root of the stand-in existing volume and another app's folder in it, as seen from outside.
foreign() {
  docker run --rm --pull never --network none --user 70:70 --read-only --cap-drop ALL --security-opt no-new-privileges --memory 64m --memory-reservation 16m --cpus 0.25 --cpu-shares 256 --tmpfs /var/lib/postgresql/data -v "$VOLUME:/v:ro" "$PG_IMAGE" stat -c '%u:%g %a %n' /v /v/neighbour-app
}

cleanup() {
  status=$?
  step 'cleanup'
  if [ -f "$work/.env" ]; then
    (cd "$work" && APP_IMAGE="$A" COMPOSE_PROJECT_NAME="$PROJECT" COMPOSE_FILE="$FILES" docker compose -p "$PROJECT" \
      --env-file .env --profile restore-test down --remove-orphans) ||
      echo "[shared] could not remove project $PROJECT" >&2
  fi
  ! docker inspect "$SERVER" >/dev/null 2>&1 || docker rm -f -v "$SERVER" >/dev/null ||
    echo "[shared] could not remove container $SERVER" >&2
  ! docker network inspect "$DBNET" >/dev/null 2>&1 || docker network rm "$DBNET" >/dev/null ||
    echo "[shared] could not remove network $DBNET" >&2
  ! docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume rm "$VOLUME" >/dev/null ||
    echo "[shared] could not remove volume $VOLUME" >&2
  rm -rf "$work"
  echo "[shared] left behind: containers=$(docker ps -aq --filter "name=$PROJECT" | wc -l | tr -d ' ') volumes=$(docker volume ls -q --filter "name=$PROJECT" | wc -l | tr -d ' ') networks=$(docker network ls -q --filter "name=$PROJECT" | wc -l | tr -d ' ')"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

step "copy the files the pipeline copies to $work, and this rehearsal's override"
tar -cf - compose.yaml compose.shared-db.yaml compose.shared-volume.yaml env.example bootstrap-env.sh deploy.sh post-deploy-check.sh \
  checks/probe.mjs postgres-init backup | tar -xf - -C "$work"
# This Mac shares one folder with Docker: the scripts go into the one volume (rehearse.sh).
cat >"$work/compose.local-shared.yaml" <<'YAML'
services:
  pg-backup:
    volumes: &scripts
      - type: volume
        source: data
        target: /scripts
        read_only: true
        volume:
          subpath: rehearsal/backup
          nocopy: true
  pg-restore-test:
    volumes: *scripts
networks:
  web: !override
    internal: true
volumes:
  data: !override
    external: true
    name: ${DATA_VOLUME}
YAML
docker volume create "$VOLUME" >/dev/null
mkdir -p "$work/seed/rehearsal"
cp -R "$work/backup" "$work/seed/rehearsal/backup"
chmod -R go=rX "$work/seed"
mkdir "$work/seed/neighbour-app"
chmod 700 "$work/seed/neighbour-app"
helper="$(docker create --pull never --network none --memory 64m --memory-reservation 16m --cpus 0.25 --cpu-shares 256 \
  -v "$VOLUME:/var/lib/postgresql/data" "$PG_IMAGE" true)"
docker cp "$work/seed/rehearsal" "$helper:/var/lib/postgresql/data/" >/dev/null
docker cp "$work/seed/neighbour-app" "$helper:/var/lib/postgresql/data/" >/dev/null
docker rm "$helper" >/dev/null
before_foreign="$(foreign)"
printf 'existing volume %s before the first deploy:\n%s\n' "$VOLUME" "$before_foreign"

step 'throwaway secrets (names only are printed) and the stand-in shared server'
TRUSTED_PROXY_IPS=127.0.0.1 sh "$work/bootstrap-env.sh" --shared-db "$SERVER" "$DBNET" portfolio.invalid rehearsal@example.invalid
! grep -q '^POSTGRES_PASSWORD=' "$work/.env" || die 'a superuser password was written for a shared server'
sed 's/^COMPOSE_FILE=.*/COMPOSE_FILE=compose.yaml:compose.shared-volume.yaml:compose.shared-db.yaml/' "$work/.env" >"$work/.env.new"
cat "$work/.env.new" >"$work/.env"
echo "DATA_VOLUME=$VOLUME" >>"$work/.env"
docker network create --internal "$DBNET" >/dev/null
admin_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
POSTGRES_PASSWORD="$admin_password"
export POSTGRES_PASSWORD
docker run -d --name "$SERVER" --pull never --network "$DBNET" --user 70:70 --memory 256m --memory-reservation 64m --cpus 0.5 --cpu-shares 256 --pids-limit 100 \
  --tmpfs /var/lib/postgresql/data:size=192m,uid=70,gid=70,mode=0700 -e POSTGRES_PASSWORD "$PG_IMAGE" >/dev/null
unset POSTGRES_PASSWORD
tries=0
until docker exec "$SERVER" pg_isready -q -h 127.0.0.1 -U postgres; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || { docker logs "$SERVER" >&2; die 'the stand-in server did not start'; }
  sleep 1
done
server_sql postgres 'CREATE DATABASE neighbour'
server_sql neighbour 'CREATE TABLE private_rows (v text); INSERT INTO private_rows VALUES ($$other app$$)'

role_script() { (
  DB_PASSWORD="$(sed -n 's/^DB_PASSWORD=//p' "$work/.env")"
  BACKUP_DB_PASSWORD="$(sed -n 's/^BACKUP_DB_PASSWORD=//p' "$work/.env")"
  PGPASSWORD="$admin_password"
  export DB_PASSWORD BACKUP_DB_PASSWORD PGPASSWORD
  docker run --rm -i --pull never --network "$DBNET" --user 70:70 --read-only --cap-drop ALL \
    --security-opt no-new-privileges --memory 64m --memory-reservation 16m --cpus 0.25 --cpu-shares 256 --tmpfs /var/lib/postgresql/data \
    -e PGHOST="$SERVER" -e PGPASSWORD -e DB_PASSWORD -e BACKUP_DB_PASSWORD -e SHARED_SERVER=1 \
    "$PG_IMAGE" sh -s <"$work/postgres-init/10-app-role.sh" >"$work/role.log" 2>&1
); }
refused() { # <reason expected in the output>
  if role_script; then die "the role script ran although: $1"; fi
  grep -q "$1" "$work/role.log" || { cat "$work/role.log" >&2; die "refused for another reason than: $1"; }
  grep 'refused\|REVOKE\|belongs\|role ' "$work/role.log"
}
ours() { server_sql postgres "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'portfolio%'"; }

step 'the role script refuses a server that is not ready, and changes nothing'
server_sql neighbour 'GRANT CREATE ON SCHEMA public TO PUBLIC'
refused 'REVOKE CONNECT, TEMPORARY ON DATABASE "neighbour" FROM PUBLIC'
grep -q 'REVOKE CREATE ON SCHEMA public FROM PUBLIC' "$work/role.log" || die 'the open schema was not listed'
[ "$(ours)" = 0 ] || die 'a refused run made a role'
server_sql postgres 'CREATE ROLE portfolio_app LOGIN CREATEDB'
refused 'portfolio_app exists and was not made by this script'
server_sql postgres 'DROP ROLE portfolio_app'
server_sql postgres 'CREATE DATABASE portfolio'
refused 'belongs to postgres, not to portfolio_owner'
server_sql postgres 'DROP DATABASE portfolio'
[ "$(ours)" = 0 ] || die 'a refused run made a role'
echo 'ok   open PUBLIC grants, a foreign role and a foreign database are refused'

step "the server owner closes the grants; the administrator's one-time command (SHARED_SERVER=1)"
server_sql neighbour 'REVOKE CREATE ON SCHEMA public FROM PUBLIC'
server_sql postgres 'REVOKE CONNECT, TEMPORARY ON DATABASE neighbour FROM PUBLIC'
role_script || { cat "$work/role.log" >&2; die 'the role script failed'; }
role_script || { cat "$work/role.log" >&2; die 'the role script failed when run again'; }
[ "$(server_sql postgres "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'portfolio'")" = portfolio_owner ] ||
  die 'the database owner is not portfolio_owner'
[ "$(server_sql postgres "SELECT rolconnlimit FROM pg_roles WHERE rolname = 'portfolio_app'")" = 10 ] ||
  die 'the app role has no connection limit'
echo 'ok   ran twice; owner portfolio_owner (cannot sign in); app role limited to 10 connections'
[ "$(server_sql postgres "SELECT pg_has_role('portfolio_backup', 'pg_read_all_data', 'MEMBER')")" = f ] ||
  die 'the backup role can read every database'
[ "$(server_sql postgres "SELECT has_database_privilege('public', 'postgres', 'CONNECT') AND has_database_privilege('public', 'template1', 'CONNECT')")" = t ] ||
  die "the script changed the server's own databases"
echo 'ok   no pg_read_all_data; the server and other databases are unchanged'

step 'the compose project has no database service'
services="$(cd "$work" && APP_IMAGE="$A" COMPOSE_PROJECT_NAME="$PROJECT" COMPOSE_FILE="$FILES" \
  docker compose -p "$PROJECT" --env-file .env --profile restore-test config --services | sort | tr '\n' ' ')"
[ "$services" = 'app pg-backup pg-restore-test ' ] || die "services: $services"
echo "ok   services: $services"

step "first deploy of $A against the empty shared database"
deploy "$A" >"$work/first.log" 2>&1 || { cat "$work/first.log" >&2; die 'the first deploy failed'; }
cat "$work/first.log"
grep -q 'no tables yet' "$work/first.log" || die 'the empty database was not dumped first'
content save "Shared marker $$"

step 'dump with the least-privilege role, restore test and compare'
compose run --rm -T -e RUN_ONCE=1 pg-backup
compose run --rm -T pg-restore-test
as_role portfolio_backup portfolio 'SELECT count(*) FROM users' >/dev/null || die 'the backup role cannot read'
for sql in 'DELETE FROM sessions' 'BEGIN READ WRITE; DELETE FROM sessions'; do
  if as_role portfolio_backup portfolio "$sql" >/dev/null 2>&1; then die "the backup role ran: $sql"; fi
done
for role in portfolio_backup portfolio_app; do
  if as_role "$role" neighbour 'SELECT v FROM private_rows' >/dev/null 2>&1; then die "$role reads another database"; fi
done
echo 'ok   backup role: reads portfolio only, writes nothing; no row of another database for either role'
for db in postgres template1; do
  if as_role portfolio_app "$db" 'DROP DATABASE portfolio' >"$work/drop.log" 2>&1; then die 'the app role dropped its database'; fi
  grep -q 'must be owner of database portfolio' "$work/drop.log" || { cat "$work/drop.log" >&2; die 'unexpected drop failure'; }
done
echo 'ok   the app role cannot drop its own database'

step 'a table made later is in the grants'
as_role portfolio_app portfolio 'CREATE TABLE rehearsal_later (id serial)' >/dev/null
compose run --rm -T -e RUN_ONCE=1 pg-backup
as_role portfolio_app portfolio 'DROP TABLE rehearsal_later' >/dev/null
echo 'ok   the dump covers a table created after the script ran'

step 'the one volume holds dumps only, and the dump job sees only the dumps folder'
compose up -d --wait --wait-timeout 90 app pg-backup
compose run --rm -T --entrypoint sh pg-folders -c '
  seen="$(ls /var/lib/postgresql/data/portfolio)"
  echo "portfolio/ in the volume: $seen"
  [ "$seen" = backups ] && stat -c "%u:%g %a %n" "$1" "$1"/portfolio-*.dump &&
    [ -z "$(find "$1" -name "portfolio-*.dump" ! -perm 600)" ] &&
    [ -z "$(find /var/lib/postgresql/data -name PG_VERSION)" ]' sh "$DUMPS" || die 'database files or open dumps on the volume'
# A stand-in for files left by an own database, in this rehearsal's volume only.
compose run --rm -T --entrypoint sh pg-folders -c 'mkdir /var/lib/postgresql/data/portfolio/pgdata && echo 17 >/var/lib/postgresql/data/portfolio/pgdata/PG_VERSION'
compose run --rm -T --entrypoint sh pg-backup -c '
  echo "pg-backup sees in portfolio/: $(ls /var/lib/postgresql/data/portfolio)"
  [ ! -e /var/lib/postgresql/data/portfolio/pgdata ]' || die 'the dump job reaches old database files'
compose --profile restore-test create pg-restore-test >/dev/null
for id in $(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"); do
  docker inspect -f '{{.Name}} memory={{.HostConfig.Memory}} read-only={{.HostConfig.ReadonlyRootfs}}{{range .Mounts}}{{if eq .Type "volume"}} {{.Destination}} rw={{.RW}}{{end}}{{end}}' "$id"
  other="$(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}' "$id" |
    grep -v "^$VOLUME\$" | grep -c . || true)"
  [ "$other" = 0 ] || die 'a second or unnamed volume is mounted'
done
compose rm -f pg-restore-test >/dev/null
[ "$(docker volume ls -q --filter "name=$PROJECT")" = "$VOLUME" ] || die "the project's volumes are not just $VOLUME"
echo "ok   one volume ($VOLUME); no database files; no unnamed volume"

step 'restore over the shared database, as in the README (throwaway server)'
newest="$(compose run --rm -T --entrypoint sh pg-backup -c 'ls "$1"/portfolio-*.dump | tail -n 1' sh "$DUMPS")"
compose stop app pg-backup
(
  PGPASSWORD="$(sed -n 's/^DB_PASSWORD=//p' "$work/.env")"
  export PGPASSWORD
  compose run --rm -T -e PGUSER=portfolio_app -e PGPASSWORD \
    --entrypoint pg_restore pg-backup --clean --if-exists --single-transaction --no-owner -d portfolio "$newest"
  compose run --rm -T -e PGUSER=portfolio_app -e PGPASSWORD \
    --entrypoint psql pg-backup -d portfolio -v ON_ERROR_STOP=1 -c 'DELETE FROM sessions'
) || die 'the live restore failed'
compose up -d --wait --wait-timeout 90 app pg-backup
content expect "Shared marker $$"
compose run --rm -T -e RUN_ONCE=1 pg-backup || die 'the backup role cannot dump after the restore'
compose run --rm -T pg-restore-test || die 'dump or compare failed after the live restore'
echo 'ok   the app role restores; the backup role still reads everything afterwards'

step "deploy ${B##*:}, then roll back"
deploy "${B##*:}"
[ "$(running_image)" = "$B" ] || die 'B is not running'
deploy --rollback
[ "$(running_image)" = "$A" ] || die 'A is not running after the rollback'
content expect "Shared marker $$"
compose run --rm -T pg-restore-test

step 'the shared server is down: nothing is deployed'
docker stop "$SERVER" >/dev/null
if deploy "$B"; then die 'deployed although the dump failed'; fi
[ "$(current)" = "$A" ] || die 'release.env moved'
compose run --rm -T -e RESTORE_COMPARE=0 pg-restore-test || die 'the restore without compare failed'

step 'the existing volume'
[ "$(foreign)" = "$before_foreign" ] || die 'the volume root or another folder in it changed'
echo "ok   root and the other app's folder unchanged"

step 'state files'
cat "$work/release.env" "$work/releases.log"
step 'PASSED'
