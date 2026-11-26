#!/bin/sh
# Local proof of the stack (T8) and of deploy and rollback (T9), with throwaway secrets.
#   sh deploy/rehearse.sh <image A> <image B>      both already built (same name, two tags)
#   KEEP=1 leaves the stack running.
#   SHARED_VOLUME=1 the same run in a stand-in existing volume (compose.shared-volume.yaml).
# It creates its own compose project, its ONE volume and two broken test images, and removes
# only those. The shared-database path: rehearse-shared.sh.
set -eu
cd "$(dirname "$0")"
[ $# -eq 2 ] || { echo 'usage: rehearse.sh <image A> <image B>' >&2; exit 2; }
A="$1"
B="$2"
PG_IMAGE="$(sed -n 's/^ *image: \(postgres:[^ ]*\)$/\1/p' compose.yaml)"
[ -n "$PG_IMAGE" ] || { echo 'no PostgreSQL image in compose.yaml' >&2; exit 1; }
PROJECT="portfolio-rehearsal-$$"
BROKEN="${A%:*}:rehearsal-broken-$$"
CRASH="${A%:*}:rehearsal-crash-$$"
VOLUME="$PROJECT-data"
DUMPS=/var/lib/postgresql/data/portfolio/backups
FILES=compose.yaml:compose.local.yaml
if [ "${SHARED_VOLUME:-0}" = 1 ]; then
  VOLUME="$PROJECT-vps"
  FILES=compose.yaml:compose.shared-volume.yaml:compose.local.yaml
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/portfolio-rehearsal.XXXXXX")"
export COMPOSE_PROJECT="$PROJECT" COMPOSE_EXTRA=compose.local.yaml

step() { printf '\n[rehearse] %s\n' "$*"; }
die() { echo "[rehearse] FAILED: $*" >&2; exit 1; }
current() { sed -n 's/^APP_IMAGE=//p' "$work/release.env"; }
compose() {
  (cd "$work" && APP_IMAGE="$(current)" COMPOSE_PROJECT_NAME="$PROJECT" COMPOSE_FILE="$FILES" \
    docker compose -p "$PROJECT" --env-file .env "$@")
}
service_id() { compose ps -q "$1"; }
running_image() { docker inspect -f '{{.Config.Image}}' "$(service_id app)"; }
content() { # save|expect <marker>
  compose exec -T -e "MODE=$1" -e "MARK=$2" app node --input-type=module - <checks/content.mjs
}
deploy() { sh "$work/deploy.sh" "$@"; }
superuser() { compose exec -T postgres psql -U postgres -d portfolio -XAtc "$1"; }
app_sql() { # SQL on stdin, over the network login, as the app role
  compose exec -T postgres sh -c 'PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U portfolio_app -d portfolio -v ON_ERROR_STOP=1 -qtA'
}
dump_now() { compose run --rm -T -e RUN_ONCE=1 "$@" pg-backup; }
health_check() { compose run --rm -T --entrypoint sh pg-backup /scripts/check.sh; }
fill() { # <name under rehearsal/> <folder>: copy the scripts into the one volume
  rm -rf "$work/seed"
  mkdir -p "$work/seed/rehearsal/$1"
  cp -R "$2/." "$work/seed/rehearsal/$1/"
  chmod -R go=rX "$work/seed"
  # Mounted at the image's VOLUME path, so this helper makes no unnamed volume, and an
  # empty volume gets the database user as its owner, as on a server. Never started.
  helper="$(docker create --pull never --network none --memory 64m --memory-reservation 16m --cpus 0.25 --cpu-shares 256 \
    -v "$VOLUME:/var/lib/postgresql/data" "$PG_IMAGE" true)"
  docker cp "$work/seed/rehearsal" "$helper:/var/lib/postgresql/data/" >/dev/null
  docker rm "$helper" >/dev/null
}
# The root of the stand-in existing volume and another app's folder in it, as seen from outside.
foreign() {
  docker run --rm --pull never --network none --user 70:70 --read-only --cap-drop ALL --security-opt no-new-privileges --memory 64m --memory-reservation 16m --cpus 0.25 --cpu-shares 256 --tmpfs /var/lib/postgresql/data -v "$VOLUME:/v:ro" "$PG_IMAGE" stat -c '%u:%g %a %n' /v /v/neighbour-app
}
# Every container of the project, stopped ones too, may mount the one volume and no other.
one_volume() {
  for id in $(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"); do
    docker inspect -f '{{.Name}}{{range .Mounts}}{{if eq .Type "volume"}} {{.Destination}} rw={{.RW}}{{end}}{{end}}' "$id"
    other="$(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}' "$id" |
      grep -v "^$VOLUME\$" | grep -c . || true)"
    [ "$other" = 0 ] || die 'a second or unnamed volume is mounted'
  done
  [ "$(docker volume ls -q --filter "name=$PROJECT")" = "$VOLUME" ] || die "the project's volumes are not just $VOLUME"
}

cleanup() {
  status=$?
  if [ "${KEEP:-0}" = 1 ]; then
    echo "[rehearse] kept: project $PROJECT, folder $work"
    exit "$status"
  fi
  step 'cleanup'
  if [ -f "$work/.env" ]; then
    (cd "$work" && APP_IMAGE="$A" COMPOSE_PROJECT_NAME="$PROJECT" COMPOSE_FILE="$FILES" docker compose -p "$PROJECT" \
      --env-file .env --profile restore-test down --remove-orphans) ||
      echo "[rehearse] could not remove project $PROJECT" >&2
  fi
  ! docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume rm "$VOLUME" >/dev/null ||
    echo "[rehearse] could not remove volume $VOLUME" >&2
  for image in "$BROKEN" "$CRASH"; do
    ! docker image inspect "$image" >/dev/null 2>&1 || docker rmi "$image" >/dev/null ||
      echo "[rehearse] could not remove image $image" >&2
  done
  rm -rf "$work"
  echo "[rehearse] left behind: containers=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | wc -l | tr -d ' ') volumes=$(docker volume ls -q --filter "name=$PROJECT" | wc -l | tr -d ' ') networks=$(docker network ls -q --filter "name=$PROJECT" | wc -l | tr -d ' ')"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

step "copy the files the pipeline copies to $work"
tar -cf - compose.yaml compose.shared-db.yaml compose.shared-volume.yaml compose.local.yaml env.example bootstrap-env.sh deploy.sh \
  post-deploy-check.sh checks/probe.mjs postgres-init backup | tar -xf - -C "$work"
docker volume create "$VOLUME" >/dev/null
fill postgres-init "$work/postgres-init"
fill backup "$work/backup"

step 'generated throwaway secrets (names only are printed)'
# No Traefik here: the loopback address stands for the proxy.
TRUSTED_PROXY_IPS=127.0.0.1 sh "$work/bootstrap-env.sh" portfolio.invalid rehearsal@example.invalid
[ -n "$(find "$work/.env" -perm 600)" ] || die '.env is not mode 600'
if sh "$work/bootstrap-env.sh" portfolio.invalid rehearsal@example.invalid 2>/dev/null; then die '.env was overwritten'; fi
echo 'ok   mode 600; a second run is refused'
if [ "${SHARED_VOLUME:-0}" = 1 ]; then
  printf '%s\n' 'COMPOSE_FILE=compose.yaml:compose.shared-volume.yaml' "DATA_VOLUME=$VOLUME" >>"$work/.env"
  mkdir -p "$work/other/neighbour-app"
  chmod 700 "$work/other/neighbour-app"
  helper="$(docker create --pull never --network none --memory 64m --memory-reservation 16m --cpus 0.25 --cpu-shares 256 -v "$VOLUME:/var/lib/postgresql/data" "$PG_IMAGE" true)"
  docker cp "$work/other/neighbour-app" "$helper:/var/lib/postgresql/data/" >/dev/null
  docker rm "$helper" >/dev/null
  before_foreign="$(foreign)"
  printf 'existing volume %s before the first deploy:\n%s\n' "$VOLUME" "$before_foreign"
fi

step 'compose config: own database, local override, shared database; one volume in each'
for files in compose.yaml "$FILES" compose.yaml:compose.shared-db.yaml compose.yaml:compose.shared-volume.yaml \
  compose.yaml:compose.shared-volume.yaml:compose.shared-db.yaml; do
  # compose <arguments>, with made-up settings for the shared file.
  as() {
    (cd "$work" && APP_IMAGE="$A" COMPOSE_PROJECT_NAME="$PROJECT" COMPOSE_FILE="$files" DB_HOST=db.invalid \
      DB_NETWORK=db-invalid DATA_VOLUME="$VOLUME" docker compose -p "$PROJECT" --env-file .env --profile restore-test "$@")
  }
  warnings="$(as config -q 2>&1)" || die "config: $warnings"
  [ -z "$warnings" ] || die "config warns: $warnings"
  [ "$(as config --volumes)" = data ] || die "$files declares more than the one volume"
  as config | grep -qF 'Host(`www.portfolio.invalid`)' &&
    as config | grep -qE 'redirectregex.replacement: https://portfolio.invalid/\$+\{1\}' ||
    die "$files: no redirect from www to the host"
  echo "ok   config clean, one volume: $files; services: $(as config --services | sort | tr '\n' ' ')"
done

mkdir "$work/empty"
printf 'FROM %s\nUSER root\nRUN rm -rf /app/dist-server\nUSER 1000:1000\n' "$B" |
  docker build -q --pull=false --provenance=false --network none -t "$BROKEN" -f - "$work/empty" >/dev/null
printf 'FROM %s\nCMD ["node", "-e", "process.exit(1)"]\n' "$B" |
  docker build -q --pull=false --provenance=false --network none -t "$CRASH" -f - "$work/empty" >/dev/null

step 'a first deploy that fails before the app creates its tables'
if WAIT_SECONDS=45 deploy "$CRASH"; then die 'the crashing image was accepted'; fi
[ ! -e "$work/release.env" ] || die 'release.env was written'
# The README recovery command, as printed there, while no release.env exists.
(cd "$work" && APP_IMAGE="$CRASH" COMPOSE_FILE="$FILES" docker compose -p "$PROJECT" --env-file .env \
  exec -T postgres sh /docker-entrypoint-initdb.d/10-app-role.sh) >/dev/null || die 'the first-start recovery command failed'
echo 'ok   the first-start script runs again without release.env'

step "the retry: first deploy of $A"
deploy "$A" >"$work/first.log" 2>&1 || { cat "$work/first.log" >&2; die 'the retry was blocked'; }
cat "$work/first.log"
grep -q 'no tables yet' "$work/first.log" || die 'the empty database was not recognised'

step 'data checksums on the new volume'
[ "$(superuser 'SHOW data_checksums')" = on ] || die 'data checksums are off'
echo 'ok   data_checksums = on'

step 'save content, then recreate every container'
content save "Rehearsal marker $$"
before="$(service_id app) $(service_id postgres)"
compose up -d --force-recreate --wait --wait-timeout 90
after="$(service_id app) $(service_id postgres)"
for id in $before; do case "$after" in *"$id"*) die 'a container was not recreated' ;; esac; done
echo 'ok   both containers are new'
content expect "Rehearsal marker $$"

step 'app database role'
compose exec -T postgres psql -U postgres -XAtc "SELECT 'superuser=' || rolsuper || ' createdb=' || rolcreatedb || ' createrole=' || rolcreaterole || ' replication=' || rolreplication FROM pg_roles WHERE rolname = 'portfolio_app'"
compose exec -T postgres psql -U postgres -XAtc "SELECT 'owner of ' || datname || ': ' || pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'portfolio'"
if compose exec -T postgres sh -c 'PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U portfolio_app -d postgres -qtAc "SELECT 1"' >/dev/null 2>&1; then
  die 'the app role can connect to the postgres database'
fi
echo 'ok   the app role cannot connect to the postgres database'
as_role() { # <role> <password variable> <database> <sql>; network login inside the database container
  compose exec -T postgres sh -c 'eval "PGPASSWORD=\$$2" && export PGPASSWORD && psql -h "$(hostname -i)" -U "$1" -d "$3" -v ON_ERROR_STOP=1 -qtAc "$4"' sh "$@"
}
as_role portfolio_app DB_PASSWORD portfolio 'SELECT 1' >/dev/null || die 'the app role cannot sign in over the network'
if as_role portfolio_app DB_PASSWORD template1 'SELECT 1' >/dev/null 2>&1; then die 'the app role can connect to template1'; fi
echo 'ok   the app role cannot connect to template1'
superuser "SELECT 'owner ' || pg_get_userbyid(datdba) || ', app limit ' || (SELECT rolconnlimit FROM pg_roles WHERE rolname = 'portfolio_app') FROM pg_database WHERE datname = 'portfolio'" |
  grep -x 'owner portfolio_owner, app limit 10' || die 'unexpected database owner or connection limit'
if as_role portfolio_app DB_PASSWORD portfolio 'ALTER DATABASE portfolio RENAME TO taken' >/dev/null 2>&1; then die 'the app role owns its database'; fi

step 'backup role: reads, cannot write, not privileged'
superuser "SELECT 'superuser=' || rolsuper || ' createdb=' || rolcreatedb || ' createrole=' || rolcreaterole || ' replication=' || rolreplication FROM pg_roles WHERE rolname = 'portfolio_backup'"
as_role portfolio_backup BACKUP_DB_PASSWORD portfolio 'SELECT count(*) FROM users' >/dev/null || die 'the backup role cannot read'
for sql in 'DELETE FROM sessions' 'BEGIN READ WRITE; DELETE FROM sessions' 'BEGIN READ WRITE; CREATE TABLE rehearsal_no (i int)'; do
  if as_role portfolio_backup BACKUP_DB_PASSWORD portfolio "$sql" >/dev/null 2>&1; then die "the backup role ran: $sql"; fi
done
for database in postgres template1; do
  if as_role portfolio_backup BACKUP_DB_PASSWORD "$database" 'SELECT 1' >/dev/null 2>&1; then die "the backup role can connect to $database"; fi
done
as_role portfolio_backup BACKUP_DB_PASSWORD portfolio 'BEGIN READ WRITE; DELETE FROM sessions' 2>&1 | grep -q 'permission denied' ||
  die 'a read-write transaction was not stopped by the grants'
echo 'ok   reads only; no write, even in a read-write transaction; portfolio database only'

step 'the first-start script can be run again by hand'
fingerprint() { superuser "SELECT md5(string_agg(rolname || coalesce(rolpassword, ''), ',' ORDER BY rolname)) FROM pg_authid WHERE rolname LIKE 'portfolio%'"; }
passwords="$(fingerprint)"
superuser 'REVOKE pg_read_all_data FROM portfolio_backup' >/dev/null
compose exec -T postgres sh /docker-entrypoint-initdb.d/10-app-role.sh >/dev/null || die 'the second run failed'
[ "$(fingerprint)" = "$passwords" ] || die 'the second run changed a password'
as_role portfolio_backup BACKUP_DB_PASSWORD portfolio 'SELECT count(*) FROM users' >/dev/null || die 'the missing grant was not restored'
echo 'ok   second run works, restores a missing grant, changes no password'

step 'dump and restore into a throwaway database'
compose run --rm -T -e RUN_ONCE=1 pg-backup
compose run --rm -T pg-restore-test
compose run --rm -T --entrypoint sh pg-backup -c 'cd "$1" && ls -ln && f=$(ls portfolio-*.dump | tail -n 1) && head -c 1500 "$f" >broken.dump' sh "$DUMPS"
if compose run --rm -T pg-restore-test "$DUMPS/broken.dump" >/dev/null 2>&1; then die 'a cut-off dump passed the restore test'; fi
echo 'ok   a cut-off dump fails the restore test'

step 'the one volume: folders, owners, and what the dump jobs can reach'
compose exec -T postgres sh -c 'stat -c "%u:%g %a %n" /var/lib/postgresql/data /var/lib/postgresql/data/portfolio \
  "$PGDATA" "${PGDATA%/*}/backups" "${PGDATA%/*}"/backups/portfolio-*.dump'
owners="$(compose exec -T postgres sh -c 'stat -c "%u:%g %a" "${PGDATA%/*}" "$PGDATA" "${PGDATA%/*}/backups" | sort -u')"
[ "$owners" = '70:70 700' ] || die "unexpected owner or mode: $owners"
[ -z "$(compose exec -T postgres sh -c 'find "${PGDATA%/*}/backups" -type f -name "portfolio-*.dump" ! -perm 600')" ] ||
  die 'a dump is readable by others'
compose run --rm -T --entrypoint sh pg-backup -c '
  seen="$(ls /var/lib/postgresql/data/portfolio)"
  echo "pg-backup sees in portfolio/: $seen"
  [ "$seen" = backups ]' || die 'the dump job can reach more than the dumps'
compose run --rm -T --entrypoint sh pg-restore-test -c '! touch "$1/rehearsal-no" 2>/dev/null' sh "$DUMPS" ||
  die 'the restore test can write to the dumps'
echo 'ok   uid 70, mode 700 folders and 600 dumps; the jobs see the dumps only; restore test reads only'

compose run --rm -T --entrypoint sh pg-backup -c '
  set -eu
  cd /var/lib/postgresql/data/portfolio/backups
  f=$(ls portfolio-*.dump | tail -n 1)
  head -c $(($(wc -c <"$f") * 9 / 10)) "$f" >cut90.dump
  echo "90% cut: the listing still shows $(pg_restore -l cut90.dump | grep -c "TABLE DATA") tables"
  if pg_restore -f /dev/null cut90.dump 2>/dev/null; then exit 1; fi
  pg_restore -f /dev/null "$f"
' || die 'reading the whole dump did not separate a cut dump from a good one'
echo 'ok   reading to the end fails the cut dump and passes the good one'

step 'restore over the live database, as in the README (throwaway stack)'
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
content expect "Rehearsal marker $$"
dump_now
compose run --rm -T pg-restore-test || die 'dump or compare failed after the live restore'

step 'a real failed dump is reported, the next good one clears it'
if dump_now -e PGPASSWORD=wrong; then die 'a dump with a wrong password passed'; fi
if health_check; then die 'the health check ignores the failed run'; fi
dump_now
health_check

step "a larger database (${FILLER_ROWS:-55000} filler rows): size warning and restore test"
app_sql <<SQL
CREATE TABLE rehearsal_filler AS
  SELECT g AS id, (SELECT string_agg(md5(random()::text || g || i), '') FROM generate_series(1, 30) AS i) AS pad
  FROM generate_series(1, ${FILLER_ROWS:-55000}) AS g;
SQL
echo "database: $(superuser "SELECT pg_size_pretty(pg_database_size('portfolio'))")"
dump_now -e RESTORE_WARN_MB=40 >"$work/big.log" 2>&1 || { cat "$work/big.log" >&2; die 'the large dump failed'; }
cat "$work/big.log"
grep -q 'WARNING: the database is' "$work/big.log" || die 'no size warning'
compose run --rm -T pg-restore-test || die 'the restore test failed on the larger database'
echo 'DROP TABLE rehearsal_filler;' | app_sql
dump_now

step 'restore test with the live database down (no compare)'
compose stop postgres
compose run --rm -T --no-deps -e RESTORE_COMPARE=0 pg-restore-test || die 'the restore without compare failed'
[ -z "$(compose ps -q --status running postgres)" ] || die 'the restore test started the database'
compose up -d --wait --wait-timeout 90

step 'nightly backup container, and limits in docker stats'
compose up -d --wait --wait-timeout 90 pg-backup
docker inspect -f 'pg-backup health: {{.State.Health.Status}}' "$(compose ps -q pg-backup)"
compose logs --no-color pg-backup | tail -n 1
ids="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")"
# shellcheck disable=SC2086 # one argument per container
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.PIDs}}' $ids
for id in $ids; do
  docker inspect -f '{{.Name}} user={{.Config.User}} read-only={{.HostConfig.ReadonlyRootfs}} memory={{.HostConfig.Memory}} nano-cpus={{.HostConfig.NanoCpus}} cap-drop={{.HostConfig.CapDrop}} log={{.HostConfig.LogConfig.Config}}' "$id"
done
# The one-shot restore test too: made, looked at, removed.
compose --profile restore-test create pg-restore-test >/dev/null
one_volume
compose rm -f pg-restore-test >/dev/null
echo "ok   one volume ($VOLUME) in every container; no unnamed volume"
if [ "${SHARED_VOLUME:-0}" = 1 ]; then
  [ "$(foreign)" = "$before_foreign" ] || die 'the volume root or another folder in it changed'
  seen="$(compose exec -T postgres ls /var/lib/postgresql/data)"
  [ "$seen" = portfolio ] || die "the database server sees more than portfolio/: $seen"
  echo 'ok   existing volume: root and the other folder unchanged; the database server sees portfolio/ only'
fi

step "deploy the second tag: ${B##*:}"
deploy "${B##*:}"
[ "$(running_image)" = "$B" ] || die 'B is not running'
content expect "Rehearsal marker $$"

step 'rollback by hand'
deploy --rollback
[ "$(running_image)" = "$A" ] || die 'A is not running after the rollback'
content expect "Rehearsal marker $$"

step 'public address down: the rollback of stage 11 and the automatic one both succeed'
deploy "$B"
if PUBLIC_CHECK=1 sh "$work/post-deploy-check.sh" "$B"; then die 'the public check passed for portfolio.invalid'; fi
(export PUBLIC_CHECK=1; deploy --undo "$B") || die 'the rollback failed with the public address down'
[ "$(running_image)" = "$A" ] || die 'A is not running'
# previous.env now holds B: a redeploy of A changes nothing, so stage 11 must not start B.
deploy "$A"
if deploy --undo "$A"; then die 'undo ran although the release was not switched'; fi
[ "$(running_image)" = "$A" ] || die 'the rejected image was started'
echo 'ok   an unchanged release is not rolled back'
if (export PUBLIC_CHECK=1; deploy "$B") >"$work/public.log" 2>&1; then die 'a failed public check was accepted'; fi
cat "$work/public.log"
grep -q "$B failed; $A is running again" "$work/public.log" || die 'the automatic rollback was not reported as good'
[ "$(running_image)" = "$A" ] || die 'A is not running after the automatic rollback'
content expect "Rehearsal marker $$"

step 'a failed dump leaves the database as it was, running or stopped, even with changed settings'
db_before="$(service_id postgres)"
sed 's/max_connections=20/max_connections=21/' "$work/compose.yaml" >"$work/compose.changed"
cp "$work/compose.changed" "$work/compose.yaml"
mkdir "$work/failing"
printf '#!/bin/sh\nexit 1\n' >"$work/failing/backup.sh"
fill backup "$work/failing"
for state in running stopped; do
  [ "$state" = running ] || compose stop postgres
  if deploy "$B"; then die 'deployed although the dump failed'; fi
  [ "$(service_id postgres)" = "$db_before" ] || die "the $state database was recreated before the dump"
  [ "$(superuser 'SHOW max_connections')" = 20 ] || die 'the new setting reached the database before the dump'
  echo "ok   $state database: same container, old setting"
done
fill backup "$work/backup"

step 'forward again (the new setting applies after the dump), then two bad images that must roll back'
deploy "$B"
[ "$(superuser 'SHOW max_connections')" = 21 ] || die 'the new setting was not applied'
echo 'ok   max_connections = 21 after a good dump'
for bad in "$BROKEN" "$CRASH"; do
  if WAIT_SECONDS=45 deploy "$bad"; then die "$bad was accepted"; fi
  [ "$(running_image)" = "$B" ] || die "B is not running after $bad"
  [ "$(current)" = "$B" ] || die 'release.env moved to a bad image'
  echo "ok   $bad refused; $B is running"
  content expect "Rehearsal marker $$"
done

step 'refused names'
for name in "${A%:*}:latest" "${A%:*}"/x 'bad name:1'; do
  if deploy "$name" 2>&1; then die "accepted $name"; fi
done

step 'drop the first-start password'
sh "$work/bootstrap-env.sh" --drop-admin-password
deploy "$B"
compose exec -T app sh -c '[ -z "$ADMIN_PASSWORD" ]' || die 'ADMIN_PASSWORD is still set'
echo 'ok   the app runs without ADMIN_PASSWORD'
content expect "Rehearsal marker $$"

step 'the nightly dump runs after a deploy with no setting, and deletes nothing'
! grep -qE '^(COMPOSE_PROFILES|BACKUP_PRUNE)=' "$work/.env" || die '.env sets a backup switch'
compose rm -sf pg-backup
deploy "$B"
[ -n "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=pg-backup)" ] ||
  die 'the deploy did not start pg-backup'
echo 'ok   pg-backup runs after a deploy'
job="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=pg-backup)"
tries=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$job")" = healthy ]; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || die 'pg-backup did not become healthy'
  sleep 1
done
echo 'ok   pg-backup is healthy'
[ "$(docker exec "$job" printenv BACKUP_PRUNE)" = 0 ] || die 'BACKUP_PRUNE is not 0'
[ "$(docker exec "$job" printenv PGUSER)" = portfolio_backup ] || die 'pg-backup does not use the read-only role'
echo 'ok   BACKUP_PRUNE=0, read-only role'
(cd "$work" && COMPOSE_FILE="$FILES" docker compose -p "$PROJECT" --env-file .env --env-file release.env ps --format '{{.Service}} {{.State}}')
one_volume

step 'state files'
cat "$work/release.env" "$work/previous.env" "$work/releases.log"
step 'PASSED'
