#!/bin/sh
# Local proof of the stack (T8) and of deploy and rollback (T9), with throwaway secrets.
#   sh deploy/rehearse.sh <image A> <image B>      both already built (same name, two tags)
#   KEEP=1 leaves the stack running.
# It creates its own compose project, volumes and two broken test images, and removes only those.
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
work="$(mktemp -d "${TMPDIR:-/tmp}/portfolio-rehearsal.XXXXXX")"
export COMPOSE_PROJECT="$PROJECT" COMPOSE_EXTRA=compose.local.yaml

step() { printf '\n[rehearse] %s\n' "$*"; }
die() { echo "[rehearse] FAILED: $*" >&2; exit 1; }
current() { sed -n 's/^APP_IMAGE=//p' "$work/release.env"; }
compose() {
  (cd "$work" && APP_IMAGE="$(current)" COMPOSE_PROJECT_NAME="$PROJECT" docker compose -p "$PROJECT" \
    -f compose.yaml -f compose.local.yaml --env-file .env "$@")
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
fill() { # <volume suffix> <folder>: copy the folder into that read-only script volume
  helper="$(docker create --pull never --network none --tmpfs /var/lib/postgresql/data -v "$PROJECT-$1:/s" "$PG_IMAGE")"
  docker cp "$2/." "$helper:/s" >/dev/null
  docker rm "$helper" >/dev/null
}

cleanup() {
  status=$?
  if [ "${KEEP:-0}" = 1 ]; then
    echo "[rehearse] kept: project $PROJECT, folder $work"
    exit "$status"
  fi
  step 'cleanup'
  if [ -f "$work/.env" ]; then
    (cd "$work" && APP_IMAGE="$A" COMPOSE_PROJECT_NAME="$PROJECT" docker compose -p "$PROJECT" -f compose.yaml \
      -f compose.local.yaml --env-file .env --profile backup --profile restore-test down -v --remove-orphans) ||
      echo "[rehearse] could not remove project $PROJECT" >&2
  fi
  for volume in "$PROJECT-init-files" "$PROJECT-backup-files"; do
    ! docker volume inspect "$volume" >/dev/null 2>&1 || docker volume rm "$volume" >/dev/null ||
      echo "[rehearse] could not remove volume $volume" >&2
  done
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
tar -cf - compose.yaml compose.local.yaml env.example bootstrap-env.sh deploy.sh post-deploy-check.sh \
  checks/probe.mjs postgres-init backup | tar -xf - -C "$work"
for pair in init-files:postgres-init backup-files:backup; do
  docker volume create "$PROJECT-${pair%:*}" >/dev/null
  fill "${pair%:*}" "$work/${pair#*:}"
done

step 'generated throwaway secrets (names only are printed)'
sh "$work/bootstrap-env.sh" portfolio.invalid rehearsal@example.invalid
[ -n "$(find "$work/.env" -perm 600)" ] || die '.env is not mode 600'
if sh "$work/bootstrap-env.sh" portfolio.invalid rehearsal@example.invalid 2>/dev/null; then die '.env was overwritten'; fi
echo 'ok   mode 600; a second run is refused'

step 'compose config: the server file alone, and with the local override'
for extra in '' '-f compose.local.yaml'; do
  # shellcheck disable=SC2086 # two words or none
  warnings="$(cd "$work" && APP_IMAGE="$A" COMPOSE_PROJECT_NAME="$PROJECT" docker compose -p "$PROJECT" -f compose.yaml $extra \
    --env-file .env --profile backup --profile restore-test config -q 2>&1)" || die "config: $warnings"
  [ -z "$warnings" ] || die "config warns: $warnings"
  echo "ok   config clean ${extra:-(compose.yaml)}"
done

mkdir "$work/empty"
printf 'FROM %s\nUSER root\nRUN rm -rf /app/dist-server\nUSER 1000:1000\n' "$B" |
  docker build -q --pull=false --provenance=false --network none -t "$BROKEN" -f - "$work/empty" >/dev/null
printf 'FROM %s\nCMD ["node", "-e", "process.exit(1)"]\n' "$B" |
  docker build -q --pull=false --provenance=false --network none -t "$CRASH" -f - "$work/empty" >/dev/null

step 'a first deploy that fails before the app creates its tables'
if WAIT_SECONDS=45 deploy "$CRASH"; then die 'the crashing image was accepted'; fi
[ ! -e "$work/release.env" ] || die 'release.env was written'
docker volume inspect "$PROJECT-pg-data" >/dev/null || die 'no database volume'
# The README recovery command, as printed there, while no release.env exists.
(cd "$work" && APP_IMAGE="$CRASH" docker compose -p "$PROJECT" -f compose.yaml -f compose.local.yaml --env-file .env \
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
compose run --rm -T --entrypoint sh pg-backup -c 'ls -ln /var/lib/postgresql/dumps; f=$(ls /var/lib/postgresql/dumps/portfolio-*.dump | tail -n 1); head -c 1500 "$f" >/var/lib/postgresql/dumps/broken.dump'
if compose run --rm -T pg-restore-test /var/lib/postgresql/dumps/broken.dump >/dev/null 2>&1; then die 'a cut-off dump passed the restore test'; fi
echo 'ok   a cut-off dump fails the restore test'
compose run --rm -T --entrypoint sh pg-backup -c '
  set -eu
  cd /var/lib/postgresql/dumps
  f=$(ls portfolio-*.dump | tail -n 1)
  head -c $(($(wc -c <"$f") * 9 / 10)) "$f" >cut90.dump
  echo "90% cut: the listing still shows $(pg_restore -l cut90.dump | grep -c "TABLE DATA") tables"
  if pg_restore -f /dev/null cut90.dump 2>/dev/null; then exit 1; fi
  pg_restore -f /dev/null "$f"
' || die 'reading the whole dump did not separate a cut dump from a good one'
echo 'ok   reading to the end fails the cut dump and passes the good one'

step 'restore over the live database, as in the README (throwaway stack)'
newest="$(compose run --rm -T --entrypoint sh pg-backup -c 'ls /var/lib/postgresql/dumps/portfolio-*.dump | tail -n 1')"
compose stop app pg-backup
(
  PGPASSWORD="$(sed -n 's/^DB_PASSWORD=//p' "$work/.env")"
  export PGPASSWORD
  compose run --rm -T -e PGUSER=portfolio_app -e PGPASSWORD \
    --entrypoint pg_restore pg-backup --clean --if-exists --single-transaction --no-owner -d portfolio "$newest"
) || die 'the live restore failed'
superuser 'DELETE FROM sessions' >/dev/null
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
  unnamed="$(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' "$id" | tr ' ' '\n' | grep -cE '^[0-9a-f]{64}$' || true)"
  [ "$unnamed" = 0 ] || die 'an unnamed volume was created'
done
echo 'ok   no unnamed volume'

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
fill backup-files "$work/failing"
for state in running stopped; do
  [ "$state" = running ] || compose stop postgres
  if deploy "$B"; then die 'deployed although the dump failed'; fi
  [ "$(service_id postgres)" = "$db_before" ] || die "the $state database was recreated before the dump"
  [ "$(superuser 'SHOW max_connections')" = 20 ] || die 'the new setting reached the database before the dump'
  echo "ok   $state database: same container, old setting"
done
fill backup-files "$work/backup"

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
(cd "$work" && docker compose -p "$PROJECT" -f compose.yaml -f compose.local.yaml --env-file .env --env-file release.env ps --format '{{.Service}} {{.State}}')

step 'state files'
cat "$work/release.env" "$work/previous.env" "$work/releases.log"
step 'PASSED'
