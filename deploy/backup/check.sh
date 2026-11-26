#!/bin/sh
# Health check of pg-backup, also usable by an outside monitor:
#   docker compose ... exec pg-backup sh /scripts/check.sh
# Unhealthy when the last run failed, or the newest dump is older than the limit.
#   BACKUP_MAX_AGE_MINUTES   default 1560 (26 hours)
set -eu
BACKUP_DIR="${BACKUP_DIR:-/var/lib/postgresql/dumps}"
if [ -f "$BACKUP_DIR/LAST_FAILURE" ]; then
  echo "[backup] ALERT: the last run failed: $(cat "$BACKUP_DIR/LAST_FAILURE")" >&2
  exit 1
fi
age="${BACKUP_MAX_AGE_MINUTES:-1560}"
if [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name 'portfolio-*.dump' -type f -mmin -"$age")" ]; then
  echo "[backup] ALERT: no dump from the last $age minutes" >&2
  exit 1
fi
echo '[backup] ok'
