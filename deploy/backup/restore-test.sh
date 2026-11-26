#!/bin/sh
# Restores a dump (default: the newest) into a throwaway database server inside this
# one-shot container, then compares it with the live database, which is only read.
# Exit 0 = they match. Rows added to the live database after the dump are ignored;
# a changed user (new password, sign-in time is not compared) shows as DIFF.
#   RESTORE_COMPARE=0   do not read the live database (during an outage, or for an older
#                       dump): exit 0 = the dump restores and has users and content.
#                       Add `--no-deps` to `compose run` when the database is down.
set -eu
BACKUP_DIR="${BACKUP_DIR:-/var/lib/postgresql/dumps}"
file="${1:-$(find "$BACKUP_DIR" -maxdepth 1 -name 'portfolio-*.dump' -type f | sort | tail -n 1)}"
[ -n "$file" ] && [ -f "$file" ] || { echo "[restore] no dump in $BACKUP_DIR" >&2; exit 1; }

data=/var/lib/postgresql/data/scratch
initdb -D "$data" -U postgres --auth=trust --encoding=UTF8 --locale=C >/tmp/initdb.log
# Unix socket only: nothing else can reach this server.
pg_ctl -D "$data" -w -l /tmp/scratch.log \
  -o "-c listen_addresses= -k /tmp -c shared_buffers=16MB -c max_connections=5 -c fsync=off -c max_wal_size=48MB -c min_wal_size=32MB" \
  start >/dev/null
trap 'pg_ctl -D "$data" -m immediate stop >/dev/null' EXIT

echo "[restore] $file into the throwaway database restore_check"
createdb -h /tmp -U postgres restore_check
pg_restore -h /tmp -U postgres -d restore_check --no-owner --no-acl --exit-on-error "$file"

restored() { psql -h /tmp -U postgres -d restore_check -XAtc "$1"; }
live() { psql -XAtc "$1"; }
status=0
if [ "${RESTORE_COMPARE:-1}" = 0 ]; then
  for table in users content_revisions audit_log sessions; do
    rows="$(restored "SELECT count(*) FROM $table")"
    echo "[restore] $table: $rows rows restored (not compared)"
    case "$table:$rows" in users:0 | content_revisions:0) status=1 ;; esac
  done
  [ "$status" = 0 ] || echo '[restore] FAILED: the dump restores without users or content' >&2
  exit "$status"
fi
compare() { # label, query that returns "<rows> <fingerprint>"
  a="$(live "$2")"
  b="$(restored "$2")"
  rows="${b%% *}"
  if [ "$a" = "$b" ] && [ "$rows" -gt 0 ]; then
    echo "[restore] OK   $1: $rows rows match"
  else
    echo "[restore] DIFF $1: live ${a%% *} rows, restored $rows rows" >&2
    status=1
  fi
}
top="$(restored 'SELECT coalesce(max(id), 0) FROM content_revisions')"
compare content_revisions "SELECT count(*) || ' ' || md5(coalesce(string_agg(id || ':' || md5(json), ',' ORDER BY id), '')) FROM content_revisions WHERE id <= $top"
compare users "SELECT count(*) || ' ' || md5(coalesce(string_agg(id || ':' || email || ':' || password_hash, ',' ORDER BY id), '')) FROM users"
top="$(restored 'SELECT coalesce(max(id), 0) FROM audit_log')"
compare audit_log "SELECT count(*) || ' ' || md5(coalesce(string_agg(id || ':' || action, ',' ORDER BY id), '')) FROM audit_log WHERE id <= $top"
# Sessions come and go; the table only has to be there.
echo "[restore] sessions: $(restored 'SELECT count(*) FROM sessions') rows restored (not compared)"
exit "$status"
