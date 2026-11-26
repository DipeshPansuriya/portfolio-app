#!/bin/sh
# Failure paths of deploy.sh, backup/backup.sh and backup/check.sh, with stand-in commands:
# no Docker, no database, only a temporary folder. rehearse.sh runs the same paths for real.
#   sh deploy/check-scripts.sh
set -eu
cd "$(dirname "$0")"
here="$(pwd)"
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
case "$*" in
  'volume inspect '*) [ "${STUB_VOLUME:-1}" = 1 ] ;;
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
  : >"$d/.env"
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
