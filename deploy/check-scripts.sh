#!/bin/sh
# Failure paths of deploy.sh, backup/backup.sh and backup/check.sh, with stand-in commands:
# no Docker, no database, only a temporary folder. rehearse.sh runs the same paths for real.
#   sh deploy/check-scripts.sh
set -eu
cd "$(dirname "$0")"
here="$(pwd)"
# The cases set these themselves; a Jenkins agent has some of them set.
unset CI_KEEP_REQUIRED KEEP_IMAGES IMAGE_KEEP_OLDER IMAGE_ID_FILE TRUSTED_PROXY_IPS
tmp="$(mktemp -d "${TMPDIR:-/tmp}/portfolio-check.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM
failed=0
check() { # <label> <command...>
  label="$1"
  shift
  if "$@"; then
    echo "ok   $label"
  else
    echo "FAIL $label" >&2
    failed=1
  fi
}
no() { ! "$@"; }

# ------------------------------------------------------------------ stand-ins
bin="$tmp/bin"
mkdir "$bin"
stub() { # <name>; body on stdin
  { echo '#!/bin/sh'; cat; } >"$bin/$1"
  chmod 755 "$bin/$1"
}
stub docker <<'EOF'
echo "$*" >>"$STUB_LOG"
[ "$1" != compose ] || echo "${COMPOSE_FILE:-}" >>"$STUB_LOG.files"
case "$*" in
  'volume inspect '*) [ "${STUB_VOLUME:-1}" = 1 ] ;;
  'version '*) echo amd64 ;;
  *Architecture*) echo "${STUB_ARCH:-amd64}" ;;
  *PG_VERSION*) [ "${STUB_NO_PGDATA:-0}" != 1 ] ;;
  'ps -q '*'service=postgres'*) [ "${STUB_DB_RUNNING:-0}" != 1 ] || echo dbid ;;
  *'service=postgres'*) [ "${STUB_OWN_DB:-0}" != 1 ] || echo dbid ;;
  *' config -q') [ "${STUB_BAD_CONFIG:-0}" != 1 ] ;;
  *RepoDigests*) echo 'repo/p@sha256:0123' ;;
  *RUN_ONCE=1*) [ "${STUB_NO_DUMP:-0}" != 1 ] ;;
esac
EOF
stub pg_dump <<'EOF'
echo dump >>"$STUB_LOG"
[ "$(grep -c '^dump$' "$STUB_LOG")" -le 20 ] || { kill -TERM "$PPID"; exit 1; }
while [ $# -gt 0 ]; do [ "$1" != -f ] || echo data >"$2"; shift; done
EOF
stub pg_restore <<'EOF'
case "$1" in
  -l) [ "${STUB_EMPTY:-0}" = 1 ] || for t in users sessions content_revisions audit_log; do echo "1; 0 0 TABLE DATA public $t app"; done ;;
  *) [ "${STUB_CUT:-0}" != 1 ] ;;
esac
EOF
stub psql <<'EOF'
case "$*" in
  *pg_tables*) echo "${STUB_TABLES:-4}" ;;
  *pg_database_size*) echo "${STUB_DB_MB:-8}" ;;
esac
EOF
for name in mv cp; do
  stub "$name" <<EOF
[ "\${STUB_FAIL:-}" != $name ] || exit 1
exec /bin/$name "\$@"
EOF
done
stub date <<'EOF'
if [ -n "${STUB_DOW:-}" ] && [ "$*" = '-u +%u' ]; then echo "$STUB_DOW"; else exec /bin/date "$@"; fi
EOF
# Records the wait, then ends the nightly loop after STUB_SLEEPS waits.
stub sleep <<'EOF'
echo "sleep $1" >>"$STUB_LOG"
[ "$(grep -c '^sleep ' "$STUB_LOG")" -lt "${STUB_SLEEPS:-2}" ] || kill -TERM "$PPID"
EOF

# ------------------------------------------------------------------ deploy.sh
new_stack() { # <folder> <current image or empty> <previous image or empty>
  d="$tmp/$1"
  mkdir "$d"
  cp "$here/deploy.sh" "$d/"
  echo 'TRUSTED_PROXY_IPS=172.18.0.2' >"$d/.env"
  [ -z "$2" ] || echo "APP_IMAGE=$2" >"$d/release.env"
  [ -z "$3" ] || echo "APP_IMAGE=$3" >"$d/previous.env"
  # Stands for a stack that is fine inside but whose public address does not answer.
  echo '[ "${PUBLIC_CHECK:-0}" != 1 ]' >"$d/post-deploy-check.sh"
  : >"$d/log"
}
deploy() { # <folder> <argument>; output in <folder>/out
  (STUB_LOG="$tmp/$1/log" PATH="$bin:$PATH" sh "$tmp/$1/deploy.sh" "$2" >"$tmp/$1/out" 2>&1)
}
deploy_undo() { # <folder> <image>
  (STUB_LOG="$tmp/$1/log" PATH="$bin:$PATH" sh "$tmp/$1/deploy.sh" --undo "$2" >"$tmp/$1/out" 2>&1)
}
released() { grep -qx "APP_IMAGE=$2" "$tmp/$1/release.env"; }
said() { grep -q -- "$2" "$tmp/$1/out"; }
called() { grep -q -- "$2" "$tmp/$1/log"; }

new_stack a repo/p:new repo/p:old
export PUBLIC_CHECK=1
check 'rollback works while the public address is down' deploy a --rollback
check 'rollback leaves the older image released' released a repo/p:old
new_stack b repo/p:old ''
check 'a deploy that fails the public check reports failure' no deploy b repo/p:new
check 'its own rollback succeeds without the public check' said b 'repo/p:old is running again'
unset PUBLIC_CHECK

# Own database (the default) and shared database.
check 'own database: compose.yaml alone when .env names no file' grep -qx compose.yaml "$tmp/b/log.files"
check 'releases.log names the one volume' grep -q ' volume=portfolio-data database=own ' "$tmp/b/releases.log"
shared_stack() { # <folder> <current image or empty>
  new_stack "$1" "$2" ''
  shared_env "$1" 'db.internal:5432/portfolio' ''
}
shared_env() { # <folder> <host:port/database of DATABASE_URL> <DB_PORT or empty>
  printf '%s\n' 'TRUSTED_PROXY_IPS=172.18.0.2' 'COMPOSE_FILE=compose.yaml:compose.shared-db.yaml' 'DB_HOST=db.internal' "DB_PORT=$3" \
    "DATABASE_URL=postgres://portfolio_app@$2" >"$tmp/$1/.env"
}
shared_stack s1 ''
# No volume yet: a shared database is dumped all the same.
export STUB_VOLUME=0
check 'shared database: the first deploy runs' deploy s1 repo/p:new
unset STUB_VOLUME
check 'shared database: dumped before the first deploy, an empty one allowed' called s1 'SKIP_IF_EMPTY=1 pg-backup'
check 'shared database: no database service is started' no called s1 ' postgres$'
check 'shared database: both compose files are used' grep -qx compose.yaml:compose.shared-db.yaml "$tmp/s1/log.files"
check 'shared database: recorded' grep -q ' database=shared ' "$tmp/s1/releases.log"
shared_stack s2 repo/p:old
check 'shared database: a later deploy runs' deploy s2 repo/p:new
check 'shared database: and dumps strictly' called s2 'SKIP_IF_EMPTY=0 pg-backup'
shared_stack s3 ''
(export STUB_NO_DUMP=1; deploy s3 repo/p:new) || true
check 'shared database: a failed dump deploys nothing' no called s3 ' up -d '
check 'shared database: and records no release' [ ! -e "$tmp/s3/release.env" ]

new_stack c '' ''
check 'first deploy retry runs' deploy c repo/p:new
check 'first deploy may skip the dump of an empty database' called c 'SKIP_IF_EMPTY=1'
new_stack d repo/p:old ''
check 'later deploy runs' deploy d repo/p:new
check 'a released stack never skips the dump' no called d 'SKIP_IF_EMPTY=1'
check 'the dump starts no dependency' called d 'run --rm -T --no-deps .*pg-backup'
check 'a released database is started as it is' called d 'up -d --no-recreate .*postgres'
check 'the nightly job starts without any setting, not waited for' called d 'up -d --no-deps --force-recreate .*pg-backup$'
check 'the app is the only service waited for with it' no called d 'up -d --wait .*--pull missing$'

check 'the dumps folder is made before a deploy' called d 'run --rm -T --no-deps pg-folders'
check 'releases.log records the registry digest' grep -q ' digest=repo/p@sha256:0123 ' "$tmp/d/releases.log"
new_stack v1 '' ''
printf '%s\n' 'COMPOSE_FILE=compose.yaml:compose.shared-volume.yaml' 'DATA_VOLUME=vps-shared' >>"$tmp/v1/.env"
check 'an existing shared volume: the deploy runs' deploy v1 repo/p:new
check 'and that volume is looked for, no other' no called v1 'volume inspect portfolio-data'
check 'and recorded' grep -q ' volume=vps-shared ' "$tmp/v1/releases.log"
new_stack v2 repo/p:old ''
(export STUB_BAD_CONFIG=1; deploy v2 repo/p:new) || true
check 'invalid compose settings: nothing is dumped or started' no called v2 ' run --rm\| up -d '
shared_stack p1 repo/p:old
shared_env p1 'db.internal:5432/portfolio' 6432
check 'shared database: a DATABASE_URL on another port is refused' no deploy p1 repo/p:new
check 'and nothing is touched' no called p1 ' run --rm\| up -d '
shared_stack p2 repo/p:old
shared_env p2 'db.internal:6432/portfolio' 6432
check 'shared database: the same other port in both is accepted' deploy p2 repo/p:new
shared_stack m1 repo/p:old
check 'a server with an own database container is not switched to shared' no env STUB_OWN_DB=1 \
  STUB_LOG="$tmp/m1/log" PATH="$bin:$PATH" sh "$tmp/m1/deploy.sh" repo/p:new
check 'and nothing is touched' no called m1 ' run --rm\| up -d '
new_stack v3 repo/p:old ''
echo 'DATA_VOLUME=vps-shared' >>"$tmp/v3/.env"
check 'DATA_VOLUME without the shared-volume file is refused' no deploy v3 repo/p:new
check 'and nothing is touched' no called v3 ' run --rm\| up -d '

# The released database must be the one the next deploy starts (own database).
released_on() { # <folder> <volume> <own|shared>: a released stack and its record
  new_stack "$1" repo/p:cur repo/p:old
  echo "2026-01-01T00:00:00Z deployed image=repo/p:cur id=x digest=none volume=$2 database=$3 project=portfolio" \
    >"$tmp/$1/releases.log"
}
to_shared_volume() {
  printf '%s\n' 'COMPOSE_FILE=compose.yaml:compose.shared-volume.yaml' 'DATA_VOLUME=vps-shared' >>"$tmp/$1/.env"
}
moving() { # <folder> <DATA_MOVED_TO> <argument> [NAME=value ...]
  folder="$1" to="$2" what="$3"
  shift 3
  env DATA_MOVED_TO="$to" STUB_LOG="$tmp/$folder/log" PATH="$bin:$PATH" "$@" \
    sh "$tmp/$folder/deploy.sh" "$what" >"$tmp/$folder/out" 2>&1
}
nothing_started() { no called "$1" ' up -d \|pg-backup\| stop ' && released "$1" repo/p:cur; }
released_on n1 portfolio-data own
to_shared_volume n1
check 'released database, another volume: the deploy is refused' no deploy n1 repo/p:new
check 'and nothing is started or dumped' nothing_started n1
check 'and the move procedure is named' said n1 'Moving the database'
check 'a rollback onto another volume is refused too' no deploy n1 --rollback
check 'and starts nothing' nothing_started n1
released_on n2 vps-shared own
check 'going back to the own volume is refused' no deploy n2 repo/p:cur
check 'and starts nothing' nothing_started n2
released_on n3 portfolio-data shared
check 'from a shared database to an own one is refused' no deploy n3 repo/p:new
check 'and starts nothing' nothing_started n3
released_on n4 portfolio-data own
check 'same volume, no database in it: refused' no env STUB_NO_PGDATA=1 STUB_LOG="$tmp/n4/log" PATH="$bin:$PATH" \
  sh "$tmp/n4/deploy.sh" repo/p:new
check 'and starts nothing' nothing_started n4
released_on n5 portfolio-data own
check 'a released volume that is gone: refused' no env STUB_VOLUME=0 STUB_LOG="$tmp/n5/log" PATH="$bin:$PATH" \
  sh "$tmp/n5/deploy.sh" repo/p:new
check 'and not made again' nothing_started n5
released_on n6 portfolio-data own
to_shared_volume n6
check 'a move to another volume than the one named is refused' no moving n6 other-volume repo/p:cur
check 'a move onto a volume without the database is refused' no moving n6 vps-shared repo/p:cur STUB_NO_PGDATA=1
check 'a move while the database still runs is refused' no moving n6 vps-shared repo/p:cur STUB_DB_RUNNING=1
check 'and none of those starts anything' nothing_started n6
: >"$tmp/n6/log"
check 'the explicit move runs' moving n6 vps-shared repo/p:cur
check 'it starts the database on the new volume before the dump' no called n6 'up -d --no-recreate .*postgres'
check 'and dumps it strictly' called n6 'SKIP_IF_EMPTY=0 pg-backup'
check 'the new volume is the record then' deploy n6 repo/p:new
released_on n7 portfolio-data own
echo '2026-01-02T00:00:00Z failed image=repo/p:bad id=x digest=none volume=vps-shared database=own project=portfolio' \
  >>"$tmp/n7/releases.log"
check 'a failed deploy does not move the record' deploy n7 repo/p:new
released_on n8 portfolio-data shared
shared_env n8 'db.internal:5432/portfolio' ''
printf '%s\n' 'DATA_VOLUME=vps-shared' >>"$tmp/n8/.env"
sed 's/^COMPOSE_FILE=.*/COMPOSE_FILE=compose.yaml:compose.shared-volume.yaml:compose.shared-db.yaml/' \
  "$tmp/n8/.env" >"$tmp/n8/env.new"
cp "$tmp/n8/env.new" "$tmp/n8/.env"
check 'shared database: the dumps may move to another volume' deploy n8 repo/p:new
new_stack a64 repo/p:old ''
check 'an image for another processor is refused' no env STUB_ARCH=arm64 STUB_LOG="$tmp/a64/log" PATH="$bin:$PATH" \
  sh "$tmp/a64/deploy.sh" repo/p:new
check 'and nothing is touched' no called a64 ' run --rm\| up -d '

mkdir "$tmp/boot"
cp "$here/bootstrap-env.sh" "$tmp/boot/"
DB_PORT=6432 sh "$tmp/boot/bootstrap-env.sh" --shared-db db.internal dbnet site.invalid a@example.invalid >/dev/null || true
check 'bootstrap writes DB_PORT' grep -qx 'DB_PORT=6432' "$tmp/boot/.env"
check 'and puts it in DATABASE_URL' grep -q '@db.internal:6432/portfolio$' "$tmp/boot/.env"

# ------------------------------------------------------------------ backup.sh
backup() { # <folder> [NAME=value ...]; the settings choose the case
  folder="$1"
  shift
  mkdir -p "$tmp/$folder/dumps/weekly"
  [ -f "$tmp/$folder/log" ] || : >"$tmp/$folder/log"
  env STUB_LOG="$tmp/$folder/log" PATH="$bin:$PATH" BACKUP_DIR="$tmp/$folder/dumps" "$@" \
    sh "$here/backup/backup.sh" >"$tmp/$folder/out" 2>&1
}
old_dumps() { # <folder> <count>: dumps dated long ago, oldest first
  mkdir -p "$tmp/$1/dumps/weekly"
  i=10
  while [ "$i" -lt $((10 + $2)) ]; do
    echo old >"$tmp/$1/dumps/portfolio-202601${i}T020000Z.dump"
    touch -t "202601${i}0200" "$tmp/$1/dumps/portfolio-202601${i}T020000Z.dump"
    i=$((i + 1))
  done
}
dumps() { find "$tmp/$1/dumps" -maxdepth 1 -name 'portfolio-*.dump' | wc -l | tr -d ' '; }
count_is() { [ "$(dumps "$1")" = "$2" ]; }
first_call() { [ "$(head -n 1 "$tmp/$1/log" | cut -d' ' -f1)" = "$2" ]; }
marked() { [ -f "$tmp/$1/dumps/LAST_FAILURE" ]; }

export RUN_ONCE=1
backup f STUB_TABLES=0 STUB_EMPTY=1 && status=0 || status=1
check 'empty database without the skip flag fails' [ "$status" = 1 ]
export SKIP_IF_EMPTY=1
backup g STUB_TABLES=0 STUB_EMPTY=1 && status=0 || status=1
check 'empty database before a first deploy is skipped' [ "$status" = 0 ]
backup h STUB_TABLES=2 STUB_EMPTY=1 && status=0 || status=1
check 'a partial schema still fails' [ "$status" = 1 ]
unset SKIP_IF_EMPTY
backup i STUB_CUT=1 && status=0 || status=1
check 'a dump that cannot be read to the end fails' [ "$status" = 1 ]
check 'and leaves no dump behind' count_is i 0
backup j STUB_DB_MB=999 && status=0 || status=1
check 'a large database still dumps' [ "$status" = 0 ]
check 'and warns about the restore test' grep -q 'WARNING.*restore test' "$tmp/j/out"
old_dumps k 10
backup k
check 'default: nothing is deleted' count_is k 11
old_dumps l 10
backup l BACKUP_PRUNE=1
check 'prune keeps the newest 7 whatever their age' count_is l 7
unset RUN_ONCE

for case in mv cp; do
  old_dumps "m$case" 10
  backup "m$case" BACKUP_PRUNE=1 STUB_DOW=7 STUB_FAIL=$case || true
  check "nightly: a failed $case is reported" grep -q 'FAILED' "$tmp/m$case/out"
  check "nightly: a failed $case leaves a marker" marked "m$case"
  check "nightly: a failed $case deletes nothing" [ "$(dumps "m$case")" -ge 10 ]
done
backup n || true
check 'start with no recent dump: dumps at once' first_call n dump
check 'then waits for the next night' grep -q '^sleep ' "$tmp/n/log"
mkdir -p "$tmp/o/dumps"
echo new >"$tmp/o/dumps/portfolio-29990101T000000Z.dump"
backup o || true
check 'start with a recent dump: waits first' first_call o sleep
backup q STUB_CUT=1 || true
check 'a failed run is retried after 15 minutes' grep -qx 'sleep 900' "$tmp/q/log"
check 'failures are kept in failures.log' [ -s "$tmp/q/dumps/failures.log" ]

# ------------------------------------------------------------------- check.sh
health() { BACKUP_DIR="$tmp/$1/dumps" sh "$here/backup/check.sh" >/dev/null 2>&1; }
check 'health: a recent dump is healthy' health n
check 'health: a failed run is unhealthy' no health q
old_dumps r 2
check 'health: only old dumps is unhealthy' no health r
: >"$tmp/q/log"
backup q RUN_ONCE=1 || true
check 'health: the next good dump clears the failure' health q

part="$tmp/y/dumps/portfolio-20260101T020000Z.dump.part"
mkdir -p "$tmp/y/dumps"
echo cut >"$part"
touch -t 202601010200 "$part"
backup y RUN_ONCE=1 BACKUP_PRUNE=1 || true
check 'an unfinished dump file is reported' grep -q 'WARNING: unfinished dump' "$tmp/y/out"
check 'and is not deleted' [ -f "$part" ]

# ------------------------------------------------------------------ post-deploy-check.sh
# Only the database network lines are read here; rehearse.sh runs the whole script for real.
mkdir "$tmp/net" "$tmp/net/bin"
cat >"$tmp/net/bin/docker" <<'EOF'
#!/bin/sh
case "$*" in
  *'.Internal'*) echo "${STUB_INTERNAL:-true}" ;;
  *'.Containers'*) echo "dbid ${STUB_STRANGER:-}" ;;
  *'com.docker.compose.project"'*)
    case "$*" in *' gone') exit 1 ;; *' other') echo another-project ;; *) echo portfolio ;; esac ;;
  ps\ *service=postgres*) echo dbid ;;
  ps\ *) echo appid ;;
esac
EOF
chmod 755 "$tmp/net/bin/docker"
net_check() { # [NAME=value ...]; output in net/out
  env PATH="$tmp/net/bin:$PATH" "$@" sh "$here/post-deploy-check.sh" >"$tmp/net/out" 2>&1 || true
}
line() { grep -q "^$1 *database network $2" "$tmp/net/out"; }
net_check
check 'an internal database network passes' line ok internal
check 'with only this project on it' line ok 'members from elsewhere'
net_check STUB_INTERNAL=false STUB_STRANGER=other
check 'a database network with a way out fails' line FAIL internal
check 'a container of another project on it fails' line FAIL 'members from elsewhere'
net_check STUB_STRANGER=gone
check 'a member that left meanwhile does not end the checks' line ok 'members from elsewhere'
# With a shared server only "no database container of our own" is checked.
mkdir "$tmp/net/shared" "$tmp/net/shared/checks"
cp "$here/post-deploy-check.sh" "$tmp/net/shared/"
: >"$tmp/net/shared/checks/probe.mjs"
echo 'COMPOSE_FILE=compose.yaml:compose.shared-db.yaml' >"$tmp/net/shared/.env"
shared_check() {
  env PATH="$tmp/net/bin:$PATH" sh "$tmp/net/shared/post-deploy-check.sh" >"$tmp/net/out" 2>&1 || true
}
shared_check
check 'shared database: a database container of our own fails' grep -q '^FAIL own database container' "$tmp/net/out"
check 'shared database: its network is not judged' no grep -q 'database network' "$tmp/net/out"

# The public address: the host of .env, and www redirected to it.
echo 'PORTFOLIO_HOST=site.invalid' >>"$tmp/net/shared/.env"
cat >"$tmp/net/bin/wget" <<'EOS'
#!/bin/sh
case "$*" in *//www.site.invalid/*) echo "  Location: ${STUB_LOCATION:-https://site.invalid/}" >&2 ;; esac
EOS
chmod 755 "$tmp/net/bin/wget"
public_check() { # [NAME=value ...]
  env PATH="$tmp/net/bin:$PATH" PUBLIC_CHECK=1 "$@" sh "$tmp/net/shared/post-deploy-check.sh" >"$tmp/net/out" 2>&1 || true
}
cat >"$tmp/net/bin/sleep" <<'EOS'
#!/bin/sh
exit 0
EOS
cat >"$tmp/net/bin/wget" <<'EOS'
#!/bin/sh
case "$*" in
  *//www.site.invalid/*) echo "  Location: ${STUB_LOCATION:-https://site.invalid/}" >&2 ;;
  *api/ready*)
    [ -n "${STUB_TRIES:-}" ] || exit 0
    echo try >>"$STUB_TRIES"
    [ "$(grep -c try "$STUB_TRIES")" -gt "${STUB_LATE:-0}" ] || exit 4 ;;
esac
EOS
chmod 755 "$tmp/net/bin/sleep" "$tmp/net/bin/wget"
public_check STUB_TRIES="$tmp/net/late" STUB_LATE=2
check 'public: an address that answers a little late passes' grep -q '^ok   public https' "$tmp/net/out"
public_check STUB_TRIES="$tmp/net/never" STUB_LATE=999 PUBLIC_WAIT_SECONDS=10
check 'public: one that never answers fails' grep -q '^FAIL public https' "$tmp/net/out"
check 'after the waiting time, not for ever' [ "$(grep -c try "$tmp/net/never")" = 3 ]
public_check
check 'public: www redirects to the host' grep -q '^ok   public www redirect' "$tmp/net/out"
check 'the www redirect label is checked' grep -q '^FAIL www redirect' "$tmp/net/out"
public_check STUB_LOCATION=https://elsewhere.invalid/
check 'public: another target is reported' grep -q '^WARN public www redirect' "$tmp/net/out"
check 'and does not fail the deploy by itself' no grep -q '^FAIL public www' "$tmp/net/out"
mkdir "$tmp/www"
cp "$here/bootstrap-env.sh" "$tmp/www/"
check 'bootstrap refuses a host that starts with www' no sh "$tmp/www/bootstrap-env.sh" www.site.invalid a@example.invalid
check 'and writes nothing' [ ! -e "$tmp/www/.env" ]

# ------------------------------------------------------------- ci.sh image clean-up
mkdir "$tmp/clean"
cat >"$tmp/clean/docker" <<'EOF'
#!/bin/sh
echo "$*" >>"$STUB_LOG"
case "$1 $2" in
  'ps -a') printf '%s\n' "$R:1.0.0-aaaaaaa3" other/app:1.0.0-99999999 ;;
  'image ls')
    # Listed in no useful order: the time the name was given decides.
    for tag in 1.0.0-11111111 1.0.0-cccccccc 1.0.0-aaaaaaa3 '<none>' 1.0.0-eeeeeeee \
      1.0.0-bbbbbbbb rehearsal-broken-1 1.0.0-dddddddd 1.0.0-ffffffff-dirty; do
      echo "$R:$tag"
    done ;;
  'image inspect')
    for last; do :; done
    case "$*" in
      *RepoDigests*)
        [ "${last#"$R":}" != 1.0.0-11111111 ] || echo "$R@sha256:1111"
        exit 0 ;;
    esac
    case "${last#"$R":}" in
      1.0.0-bbbbbbbb) at='09 10:00:00' ;;
      1.0.0-cccccccc) at='08 10:00:00.5' ;;
      1.0.0-dddddddd) at='08 10:00:00' ;;
      1.0.0-aaaaaaa3) at='06 10:00:00' ;;
      1.0.0-eeeeeeee) at='05 10:00:00' ;;
      1.0.0-ffffffff-dirty) at='04 10:00:00' ;;
      rehearsal-broken-1) at='03 10:00:00' ;;
      1.0.0-11111111) at='02 10:00:00' ;;
      *) exit 1 ;;
    esac
    echo "2026-01-$at +0000 UTC" ;;
esac
EOF
chmod 755 "$tmp/clean/docker"
R="$(sed -n 's/^IMAGE_REPO=//p' "$here/../scripts/ci.sh")"
export R
clean() { # <log name> <image> [NAME=value ...]
  log="$tmp/clean/$1"
  image="$2"
  shift 2
  : >"$log"
  env STUB_LOG="$log" PATH="$tmp/clean:$PATH" APP_IMAGE="$image" "$@" \
    sh "$here/../scripts/ci.sh" --clean-images >"$log.out" 2>&1
}
removed() { # <log name>: the tags removed, in order, on one line
  sed -n "s|^image rm $R:||p" "$tmp/clean/$1" | tr '\n' ' '
}
check 'clean-up runs' clean one "$R:1.0.0-cccccccc" KEEP_IMAGES="x:1 $R:1.0.0-eeeeeeee"
check 'only older tags go: not newer, previous, in use, kept, or foreign ones' \
  [ "$(removed one)" = '1.0.0-ffffffff-dirty 1.0.0-11111111 ' ]
check 'never a prune or a forced removal' no grep -qE 'prune|^(image rm|rmi|rm) (.* )?(-f|--force)( |$)' "$tmp/clean/one"
check 'clean-up with no spare tag' clean two "$R:1.0.0-cccccccc" IMAGE_KEEP_OLDER=0
check 'removes the previous one too, never one in use' \
  [ "$(removed two)" = '1.0.0-dddddddd 1.0.0-eeeeeeee 1.0.0-ffffffff-dirty 1.0.0-11111111 ' ]
check 'another image name: clean-up runs' clean three portfolio:qa-scratch
check 'and Docker is not touched' [ ! -s "$tmp/clean/three" ]
check 'a current image that is not listed: clean-up runs' clean four "$R:1.0.0-00000000"
check 'and removes nothing' [ -z "$(removed four)" ]
check 'clean-up with kept images written with a digest' clean five "$R:1.0.0-cccccccc" IMAGE_KEEP_OLDER=0 \
  KEEP_IMAGES="$R:1.0.0-eeeeeeee@sha256:eeee $R@sha256:1111"
check 'keeps both, by tag and by digest' [ "$(removed five)" = '1.0.0-dddddddd 1.0.0-ffffffff-dirty ' ]
check 'a keep list required but empty: clean-up runs' clean six "$R:1.0.0-cccccccc" CI_KEEP_REQUIRED=1
check 'and removes nothing then' [ -z "$(removed six)" ]

# --------------------------------------------- keep list of pipeline stage 11's clean-up
# That script, taken from the Jenkinsfile: the helper prints one state file, then fails.
mkdir "$tmp/keep" "$tmp/keep/scripts"
echo 'echo "cleaned with: $KEEP_IMAGES"' >"$tmp/keep/scripts/ci.sh"
cat >"$tmp/keep/docker" <<'EOF'
#!/bin/sh
echo 'APP_IMAGE=repo/p:now'
exit "${STUB_READ:-0}"
EOF
chmod 755 "$tmp/keep/docker"
keep_list() { # [NAME=value ...]
  script="$(sed -n '/^ *state="\$(docker run /,/sh scripts\/ci.sh --clean-images$/p' "$here/../Jenkinsfile")"
  [ -n "$script" ] || { echo 'no clean-up script found' >&2; return 2; }
  (cd "$tmp/keep" && env PATH="$tmp/keep:$PATH" DEPLOY_USER=1000:1000 DEPLOY_CLI_IMAGE=cli@sha256:0 "$@" sh -euc "$script" >out 2>&1)
}
check 'stage 11 passes the recorded images to the clean-up' keep_list
check 'by name' grep -qx 'cleaned with: repo/p:now' "$tmp/keep/out"
check 'a state file that cannot be read stops the step' no keep_list STUB_READ=1
check 'and for that reason' no grep -qiE 'unbound|not set|parameter' "$tmp/keep/out"
check 'and nothing is cleaned' no grep -q 'cleaned with' "$tmp/keep/out"

# ------------------------------------------------------- rollback of pipeline stage 11
# The script of stage 11 itself, taken from the Jenkinsfile and pointed at a stand-in folder.
stage11() { # <folder> <image>; the public address does not answer
  script="$(sed -n "/stage('11:/,/' check \"\$APP_IMAGE\"/p" "$here/../Jenkinsfile" |
    sed -n "/ sh -c '/,\$p" | sed "1s/.* sh -c '//; \$s/' check .*//; s|/docker/portfolio|$tmp/$1|g")"
  [ -n "$script" ] || { echo 'no stage 11 script found' >&2; return 0; }
  (STUB_LOG="$tmp/$1/log" PATH="$bin:$PATH" PUBLIC_CHECK=1 sh -c "$script" check "$2" >"$tmp/$1/out" 2>&1)
}
new_stack s repo/p:bad repo/p:good
deploy s --rollback
deploy s repo/p:good
: >"$tmp/s/log"
check 'stage 11, release unchanged: still reports failure' no stage11 s repo/p:good
check 'the good image stays released' released s repo/p:good
check 'the rejected image is not started' no called s 'compose'
new_stack t repo/p:old ''
deploy t repo/p:new
check 'stage 11, release switched: reports failure' no stage11 t repo/p:new
check 'and goes back to the image before' released t repo/p:old
check 'a second run still reports failure' no stage11 t repo/p:old
check 'and does not go forward again' released t repo/p:old
new_stack u repo/p:old ''
deploy u repo/p:new
deploy u repo/p:newer
check 'an undo for an image that is not the last switch is refused' no deploy_undo u repo/p:new
check 'and changes nothing' released u repo/p:newer

# A failed undo (dump, image, checks) must be possible to run again.
stub docker <<'EOF'
echo "$*" >>"$STUB_LOG"
case "$*" in
  'volume inspect '*) [ "${STUB_VOLUME:-1}" = 1 ] ;;
  'version '*) echo amd64 ;;
  *Architecture*) echo amd64 ;;
  'image inspect '* | 'pull '*) [ "${STUB_NO_IMAGE:-0}" != 1 ] ;;
  *RUN_ONCE=1*) [ "${STUB_NO_DUMP:-0}" != 1 ] ;;
esac
EOF
for broken in STUB_NO_DUMP STUB_NO_IMAGE STUB_BAD_IMAGE; do
  s="z$broken"
  new_stack "$s" repo/p:old ''
  # Inside checks fail for the one image named in STUB_BAD_IMAGE.
  echo '[ "$1" != "${STUB_BAD_IMAGE:-}" ]' >"$tmp/$s/post-deploy-check.sh"
  deploy "$s" repo/p:new
  value=1
  [ "$broken" != STUB_BAD_IMAGE ] || value=repo/p:old
  export "$broken=$value"
  check "$broken: the undo fails" no deploy_undo "$s" repo/p:new
  check "$broken: the new image stays released" released "$s" repo/p:new
  unset "$broken"
  check "$broken: the same undo can be run again" deploy_undo "$s" repo/p:new
  check "$broken: and goes back" released "$s" repo/p:old
  check "$broken: once it has worked it is refused" no deploy_undo "$s" repo/p:new
done
# After a successful undo, going forward by hand does not bring the old switch back.
deploy zSTUB_NO_DUMP --rollback
check 'a switch that was undone stays undone' no deploy_undo zSTUB_NO_DUMP repo/p:new
# A failed deploy of another image still voids the earlier switch.
new_stack zf repo/p:old ''
deploy zf repo/p:new
(export STUB_NO_DUMP=1; deploy zf repo/p:newer) || true
check 'after a later failed deploy the older undo is refused' no deploy_undo zf repo/p:new
check 'and the release is unchanged' released zf repo/p:new

# --------------------------------------------- the release archive of pipeline stage 9
# load-release.sh against hand-made archives. The docker here only records what it is given.
L="$tmp/load"
mkdir -p "$L/deploy" "$L/scripts" "$L/bin"
cp "$here/load-release.sh" "$L/deploy/" 2>/dev/null || :
echo 'IMAGE_REPO=reg.invalid/own/app' >"$L/scripts/ci.sh"
NAME=reg.invalid/own/app:1.0.0-0123abcd
OTHER=reg.invalid/other/service:2
cat >"$L/bin/docker" <<'EOF'
#!/bin/sh
echo "$*" >>"$STUB_LOG"
case "$1 ${2:-}" in
  'info -f') echo "[[driver-type ${STUB_STORE:-io.containerd.snapshotter.v1}]]" ;;
  'version -f') echo linux/amd64 ;;
  'load ')
    cat >"$STUB_LOG.tar"
    : >"$STUB_LOG.loaded"
    echo "Loaded image: $STUB_NAME"
    [ -z "${STUB_EXTRA:-}" ] || echo "Loaded image: $STUB_EXTRA" ;;
  'image inspect')
    case "$*" in *Architecture*) echo "${STUB_PLATFORM:-linux/amd64}"; exit 0 ;; esac
    if [ -e "$STUB_LOG.loaded" ]; then echo "$STUB_AFTER"
    elif [ -n "${STUB_BEFORE:-}" ]; then echo "$STUB_BEFORE"
    else exit 1; fi ;;
esac
EOF
chmod 755 "$L/bin/docker"
sum() { if command -v sha256sum >/dev/null; then sha256sum <"$1"; else shasum -a 256 <"$1"; fi | cut -d ' ' -f 1; }
blob() { # <content>: a blob of the folder $src; prints its digest
  printf '%s' "$1" >"$L/blob"
  digest="$(sum "$L/blob")"
  cp "$L/blob" "$src/blobs/sha256/$digest"
  echo "$digest"
}
entry() { # <digest> <size> <name>: one image of index.json
  printf '{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"sha256:%s","size":%s,"annotations":{"io.containerd.image.name":"%s","org.opencontainers.image.ref.name":"%s"}}' \
    "$1" "$2" "$3" "${3##*:}"
}
index() { # <entries>
  printf '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[%s]}' "$1" >"$src/index.json"
}
listed() { # <RepoTags content>: manifest.json
  printf '[{"Config":"blobs/sha256/%s","RepoTags":[%s],"Layers":["blobs/sha256/%s"]}]' "$cfg" "$1" "$lay" >"$src/manifest.json"
}
new_archive() { # <case>: a well-formed folder to pack; sets src, man, id
  src="$L/$1"
  mkdir -p "$src/blobs/sha256"
  man="$(blob '{"manifest":1}')"
  cfg="$(blob '{"config":1}')"
  lay="$(blob 'layer')"
  id="sha256:$man"
  index "$(entry "$man" 14 "$NAME")"
  listed "\"$NAME\""
  printf '{"imageLayoutVersion":"1.0.0"}' >"$src/oci-layout"
}
pack() { # <case> [more members]
  folder="$1"
  shift
  COPYFILE_DISABLE=1 tar -cf "$L/$folder.tar" -C "$L/$folder" blobs index.json manifest.json oci-layout "$@"
}
# One load per case that reaches Docker: the stand-in remembers a load by a file of the case.
load() { # <case> <name> <image ID> [NAME=value ...]
  case_="$1" name_="$2" id_="$3"
  shift 3
  : >"$L/$case_.log"
  env STUB_LOG="$L/$case_.log" STUB_NAME="$NAME" STUB_AFTER="$id_" "$@" PATH="$L/bin:$PATH" \
    sh "$L/deploy/load-release.sh" "$L/$case_.tar" "$name_" "$id_" >"$L/$case_.out" 2>&1
}
refused() { # <case> <name> <image ID> [NAME=value ...]: fails by its own word, loads nothing
  ! load "$@" && grep -q '^\[load\]' "$L/$1.out" && ! grep -q '^load' "$L/$1.log"
}
hostile() { # <label> <case>: pack the folder as it is now; it must be refused
  pack "$2"
  check "archive refused: $1" refused "$2" "$NAME" "$id"
}

new_archive good
pack good
check 'a release archive with this one image is loaded' load good "$NAME" "$id"
given() { tar -tf "$L/good.log.tar" | grep -v '/$' | sed 's|blobs/sha256/.*|blob|' | sort | uniq -c | tr -s ' \n' ' '; }
check 'docker gets the checked files only, no manifest.json' [ "$(given 2>/dev/null)" = ' 3 blob 1 index.json 1 oci-layout ' ]

# `docker build` also records the image's configuration in index.json.
with_config() { # <digest>: index.json as saved after a build
  index "$(entry "$man" 14 "$NAME" | sed "s|\"annotations\":{|&\"config.digest\":\"sha256:$1\",|")"
}
new_archive built
with_config "$cfg"
pack built
check 'an archive of a built image (config.digest) is loaded' load built "$NAME" "$id"
new_archive otherconfig
with_config "$lay"
hostile 'config.digest differing from the configuration in manifest.json' otherconfig

new_archive tags
listed "\"$NAME\",\"$OTHER\""
hostile 'a second name in manifest.json' tags
new_archive images
printf '[{"Config":"blobs/sha256/%s","RepoTags":["%s"],"Layers":["blobs/sha256/%s"]},{"Config":"blobs/sha256/%s","RepoTags":["%s"],"Layers":["blobs/sha256/%s"]}]' \
  "$cfg" "$NAME" "$lay" "$cfg" "$OTHER" "$lay" >"$src/manifest.json"
hostile 'a second image in manifest.json' images
new_archive second
index "$(entry "$man" 14 "$NAME"),$(entry "$man" 14 "$OTHER")"
hostile 'a second name in index.json' second
new_archive renamed
index "$(entry "$man" 14 "$OTHER")"
hostile 'another name in index.json' renamed
new_archive twice
index "$(entry "$man" 14 "$NAME" | sed "s|\"org.opencontainers|\"io.containerd.image.name\":\"$OTHER\",&|")"
hostile 'a name key given twice' twice
new_archive again
pack again
mkdir "$L/evil"
src="$L/evil"
index "$(entry "$man" 14 "$OTHER")"
COPYFILE_DISABLE=1 tar -rf "$L/again.tar" -C "$L/evil" index.json
check 'archive refused: a second index.json member' refused again "$NAME" "$id"
new_archive alias
pack alias ./index.json
check 'archive refused: index.json under another path' refused alias "$NAME" "$id"
new_archive legacy
echo '{"other/service":{"2":"x"}}' >"$L/legacy/repositories"
pack legacy repositories
check 'archive refused: a repositories file' refused legacy "$NAME" "$id"
new_archive link
ln -s /etc/hosts "$L/link/blobs/sha256/$(printf '%064d' 0)"
hostile 'a symbolic link' link
new_archive forged
echo forged >"$L/forged/blobs/sha256/$(printf '%064d' 1)"
hostile 'a blob that does not match its name' forged
new_archive gone
man="$(printf '%064d' 4)"
id="sha256:$man"
index "$(entry "$man" 14 "$NAME")"
hostile 'the recorded image is not inside' gone
new_archive unrecorded
pack unrecorded
check 'archive refused: another ID than the one recorded' refused unrecorded "$NAME" "sha256:$(printf '%064d' 2)"
check 'archive refused: no recorded ID' refused unrecorded "$NAME" ''
n=0
for foreign in traefik:1.0.0-0123abcd "$OTHER" reg.invalid/own/app:latest reg.invalid/own/app/x:1.0.0-0123abcd; do
  n=$((n + 1))
  new_archive "f$n"
  index "$(entry "$man" 14 "$foreign")"
  listed "\"$foreign\""
  pack "f$n"
  check "name refused: $foreign" refused "f$n" "$foreign" "$id"
done
new_archive store
pack store
check 'a Docker without the containerd image store is refused' refused store "$NAME" "$id" STUB_STORE=overlay2
new_archive after
pack after
check 'another ID after the load fails' no load after "$NAME" "$id" STUB_AFTER="sha256:$(printf '%064d' 3)"
check 'and removes that name again' grep -qx "image rm $NAME" "$L/after.log"
new_archive earlier
pack earlier
check 'a name that already holds another image is never overwritten' refused earlier "$NAME" "$id" \
  STUB_BEFORE=sha256:earlier
new_archive repeat
pack repeat
check 'the same image again is accepted' load repeat "$NAME" "$id" STUB_BEFORE="$id"
new_archive arm
pack arm
check 'an image for another processor than this server fails' no load arm "$NAME" "$id" STUB_PLATFORM=linux/arm64
check 'and its name is removed' grep -qx "image rm $NAME" "$L/arm.log"
new_archive extra
pack extra
check 'a second loaded name in the output fails' no load extra "$NAME" "$id" STUB_EXTRA="$OTHER"

# --------------------------------------------- DEPLOY_USER check of pipeline stage 10
user_check() { # <DEPLOY_USER>: the check itself, taken from the Jenkinsfile
  script="$(sed -n '/^ *case "\${DEPLOY_USER:-}" in$/,/^ *tar -cf - -C deploy /p' "$here/../Jenkinsfile" | sed '$d')"
  [ -n "$script" ] || return 2
  env DEPLOY_USER="$1" sh -euc "$script" >/dev/null 2>&1
}
for good in 1000:1000 1001:999; do check "DEPLOY_USER $good is accepted" user_check "$good"; done
for bad in '' 0 0:0 00:00 1000:0 1000:00 0:1000 00:1000 01000:1000 root root:root 1000 1000: :1000 \
  1000:1000:1 4294967296:1000 "$(printf '1000:1000\n0:0')"; do
  check "DEPLOY_USER '$(printf '%s' "$bad" | tr '\n' ' ')' is refused" no user_check "$bad"
done

# --------------------------------------------- the proxy address (TRUSTED_PROXY_IPS)
proxy_stack() { # <folder> <line of .env>
  new_stack "$1" repo/p:old ''
  printf '%s\n' "$2" >"$tmp/$1/.env"
}
proxy_refused() { no deploy "$1" repo/p:new && said "$1" TRUSTED_PROXY_IPS && [ ! -s "$tmp/$1/log" ]; }
p=0
for bad in '' '=' '= ' '=,' '=0.0.0.0/0' '=10.0.0.0/8' '=172.16.0.0/12' '=::/0' '=fc00::/7' \
  '=172.18.0.2,0.0.0.0/0' '=traefik' '=*' '="172.18.0.2"' '=172.18.0.2 # proxy'; do
  p=$((p + 1))
  proxy_stack "px$p" "${bad:+TRUSTED_PROXY_IPS$bad}"
  check "proxy list '${bad:-missing}': refused before anything" proxy_refused "px$p"
done
for good in 172.18.0.2 172.18.0.0/16 '172.18.0.2, 10.0.1.5/32' fd00:1::2 fd00:1::/64; do
  p=$((p + 1))
  proxy_stack "px$p" "TRUSTED_PROXY_IPS=$good"
  check "proxy list '$good': deploys" deploy "px$p" repo/p:new
done
mkdir "$tmp/boot1" "$tmp/boot2" "$tmp/boot3"
for n in 1 2 3; do cp "$here/bootstrap-env.sh" "$tmp/boot$n/"; done
TRUSTED_PROXY_IPS=172.18.0.2 sh "$tmp/boot1/bootstrap-env.sh" site.invalid a@example.invalid >"$tmp/boot1/out" || true
check 'bootstrap writes the proxy address' grep -qx 'TRUSTED_PROXY_IPS=172.18.0.2' "$tmp/boot1/.env"
env -u TRUSTED_PROXY_IPS sh "$tmp/boot2/bootstrap-env.sh" site.invalid a@example.invalid >"$tmp/boot2/out" 2>&1 || true
check 'without one it writes the empty name' grep -qx 'TRUSTED_PROXY_IPS=' "$tmp/boot2/.env"
check 'and says that deploy.sh needs it' grep -q 'set TRUSTED_PROXY_IPS' "$tmp/boot2/out"
check 'bootstrap refuses a proxy value with other characters' no env TRUSTED_PROXY_IPS="$(printf '1.2.3.4\nX=1')" \
  sh "$tmp/boot3/bootstrap-env.sh" site.invalid a@example.invalid
check 'and writes no file then' [ ! -e "$tmp/boot3/.env" ]

# ------------------------------------------------------- commands printed in README.md
mkdir "$tmp/readme"
cat >"$tmp/readme/docker" <<'EOF'
#!/bin/sh
echo "$*" >>"$STUB_LOG"
# Like compose: every env file must exist, and APP_IMAGE must come from somewhere.
before=
for word; do
  [ "$before" != --env-file ] || [ -f "$word" ] || { echo "no env file $word" >&2; exit 1; }
  before="$word"
done
[ -n "${APP_IMAGE:-}" ] || case "$*" in
  *'--env-file release.env'*) ;;
  *) echo 'APP_IMAGE is not set' >&2; exit 1 ;;
esac
[ "${STUB_NO_DUMP:-0}" != 1 ] || case "$*" in *RUN_ONCE=1*) exit 1 ;; esac
EOF
chmod 755 "$tmp/readme/docker"
readme() { # <folder> <heading> [shell option]: run the first bash block under that heading
  { grep '^C=' "$here/README.md"
    awk -v h="$2" '$0 == h { s = 1; next } s && /^```bash$/ { b = 1; next } b && /^```$/ { exit } b' \
      "$here/README.md"; } >"$tmp/$1/run.sh"
  [ "$(wc -l <"$tmp/$1/run.sh")" -gt 1 ] || return 2
  # shellcheck disable=SC2086 # one option or none
  (cd "$tmp/$1" && F=/dumps/x.dump STUB_LOG="$tmp/$1/log" PATH="$tmp/readme:$bin:$PATH" sh ${3:-} run.sh >out 2>&1)
}
new_stack v '' ''
check 'README: the first-start recovery runs without release.env' readme v '### The first-start script failed' -e
check 'README: it runs the init script' called v 'exec .*postgres sh .*10-app-role.sh'
new_stack w repo/p:cur repo/p:old
echo 'DB_PASSWORD=stand-in' >"$tmp/w/.env"
(export STUB_NO_DUMP=1; readme w '### Restore over the live database') || true
check 'README: no live restore after a failed safety dump' no called w '--entrypoint pg_restore'
: >"$tmp/w/log"
check 'README: the live restore block runs' readme w '### Restore over the live database'
check 'README: and restores' called w '--entrypoint pg_restore'
new_stack x repo/p:cur repo/p:old
check 'README: rollback without a dump runs' readme x '### Rollback when the dump fails' -e
check 'README: it starts the app alone' called x 'up -d --no-deps .* app$'
check 'README: it records the older image' released x repo/p:old
check 'README: and keeps the replaced one' grep -qx 'APP_IMAGE=repo/p:cur' "$tmp/x/previous.env"

[ "$failed" = 0 ] || { echo '[check-scripts] FAILED' >&2; exit 1; }
echo '[check-scripts] passed'
