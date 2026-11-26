#!/bin/sh
# pg-backup: `pg_dump -Fc` of the portfolio database, nightly at 02:00 UTC (ADR 0005).
# A dump counts only when pg_dump worked, pg_restore can list its tables AND can read it to
# the end; otherwise it is dropped, the run fails and nothing old is touched.
# A failed run writes $BACKUP_DIR/LAST_FAILURE (check.sh then reports unhealthy) and adds a
# line to failures.log; the next good run removes the marker.
# The job also dumps at once when it starts with no dump from the last 24 hours.
#   RUN_ONCE=1            dump now and exit (deploy.sh does this before every deploy)
#   SKIP_IF_EMPTY=1       with RUN_ONCE: no tables at all is not an error (first deploy only)
#   BACKUP_RETRY_SECONDS  wait before a failed nightly run is tried again, default 900
#   RESTORE_WARN_MB       warn when the database is larger than this (restore-test.sh space)
#   BACKUP_PRUNE=1        delete dumps older than 7 days (daily) or 28 days (weekly), but
#                         never the newest 7 daily and 4 weekly. Off until the owner approves.
# Every step checks its own result: `set -e` is off inside a function that is tested by
# `if` or `||`.
set -eu
umask 077 # dumps hold the password hash and visitor addresses: owner only
# A folder of the one volume (compose.yaml).
BACKUP_DIR="${BACKUP_DIR:-/var/lib/postgresql/data/portfolio/backups}"

drop() { # <part file> <reason>; always fails
  rm -f "$1"
  echo "[backup] FAILED: $2" >&2
  return 1
}

prune() { # <folder> <days> <newest to keep>
  names="$(find "$1" -maxdepth 1 -name 'portfolio-*.dump' -type f)" || return 1
  # The names carry the UTC time, so reverse order is newest first.
  for old in $(echo "$names" | sort -r | tail -n +$(($3 + 1))); do
    find "$old" -mtime +"$2" -exec rm -f {} + || return 1
  done
}

dump() {
  saved=0
  mkdir -p "$BACKUP_DIR/weekly" || { echo "[backup] FAILED: cannot make $BACKUP_DIR/weekly" >&2; return 1; }
  if [ "${RUN_ONCE:-0}" = 1 ] && [ "${SKIP_IF_EMPTY:-0}" = 1 ]; then
    tables="$(psql -XAtc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")" ||
      { echo '[backup] FAILED: cannot count the tables' >&2; return 1; }
    if [ "$tables" = 0 ]; then
      echo '[backup] the database has no tables yet: nothing to dump'
      return 0
    fi
  fi
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="$BACKUP_DIR/portfolio-$stamp.dump"
  pg_dump -Fc -f "$file.part" || { drop "$file.part" 'pg_dump error'; return 1; }
  listing="$(pg_restore -l "$file.part")" || listing=
  for table in users sessions content_revisions audit_log; do
    case "$listing" in
      *"TABLE DATA public $table "*) ;;
      *) drop "$file.part" "the dump has no data entry for $table"; return 1 ;;
    esac
  done
  # The listing only reads the table of contents; a cut-off file passes it.
  pg_restore -f /dev/null "$file.part" || { drop "$file.part" 'the dump cannot be read to the end'; return 1; }
  mv "$file.part" "$file" || { drop "$file.part" "cannot save $file"; return 1; }
  saved=1
  echo "[backup] $(wc -c <"$file") bytes $file"
  # Sunday's dump is also kept as the weekly one.
  if [ "$(date -u +%u)" = 7 ]; then
    weekly="$BACKUP_DIR/weekly/portfolio-$stamp.dump"
    { cp "$file" "$weekly.part" && mv "$weekly.part" "$weekly"; } ||
      { drop "$weekly.part" "cannot save the weekly copy $weekly"; return 1; }
  fi
  [ "${BACKUP_PRUNE:-0}" = 1 ] || return 0
  prune "$BACKUP_DIR" 7 7 || { echo '[backup] FAILED: pruning the daily dumps' >&2; return 1; }
  prune "$BACKUP_DIR/weekly" 28 4 || { echo '[backup] FAILED: pruning the weekly dumps' >&2; return 1; }
}

size_warning() {
  limit="${RESTORE_WARN_MB:-80}"
  size="$(psql -XAtc 'SELECT pg_database_size(current_database()) / 1048576')" || return 0
  case "$size" in '' | *[!0-9]*) return 0 ;; esac
  [ "$size" -le "$limit" ] ||
    echo "[backup] WARNING: the database is $size MB (over $limit MB): the restore test may run out of space" >&2
}

# A job killed during a dump cannot clean up after itself. Nothing here deletes the file.
part_warning() {
  left="$(find "$BACKUP_DIR" -name '*.part' -type f -mmin +60 2>/dev/null)" || return 0
  [ -z "$left" ] || printf '[backup] WARNING: unfinished dump files, remove by hand:\n%s\n' "$left" >&2
}

backup() {
  part_warning
  if dump; then
    rm -f "$BACKUP_DIR/LAST_FAILURE"
    size_warning
    return 0
  fi
  when="$(date -u +%FT%TZ)"
  echo "[backup] ALERT: run FAILED $when" >&2
  # On a full disk these writes can fail too; check.sh then still sees the dumps grow old.
  { echo "$when" >"$BACKUP_DIR/LAST_FAILURE" && echo "$when run failed" >>"$BACKUP_DIR/failures.log"; } ||
    echo '[backup] ALERT: could not record the failure' >&2
  return 1
}

if [ "${RUN_ONCE:-0}" = 1 ]; then
  backup || exit 1
  exit 0
fi

trap 'exit 0' INT TERM
nap() { # <seconds>
  sleep "$1" &
  wait $!
}
until_next_run() {
  # Seconds to the next 02:00 UTC; a full day when it is exactly 02:00.
  wait_for=$(((7200 - $(date -u +%s) % 86400 + 86400) % 86400))
  [ "$wait_for" -ne 0 ] || wait_for=86400
  echo "[backup] next dump in ${wait_for}s"
  nap "$wait_for"
}

# Catch up: a restart after 02:00 UTC must not skip the day.
recent="$(find "$BACKUP_DIR" -maxdepth 1 -name 'portfolio-*.dump' -type f -mmin -1440 2>/dev/null)" || recent=
[ -z "$recent" ] || until_next_run
while true; do
  if backup || [ "$saved" = 1 ]; then
    # Saved, even if a later step failed: another try now would only pile up dumps.
    until_next_run
  else
    nap "${BACKUP_RETRY_SECONDS:-900}"
  fi
done
