#!/bin/sh
# Writes the server's .env with new random secrets, once. Prints names, never values.
#   sh bootstrap-env.sh <public host name> <admin email>
#   sh bootstrap-env.sh --drop-admin-password     after the first start created the owner
# The file lands next to this script. An existing .env is never overwritten.
set -eu
umask 077
cd "$(dirname "$0")"
die() { echo "[bootstrap] $*" >&2; exit 1; }

if [ "${1:-}" = --drop-admin-password ]; then
  [ -f .env ] || die 'no .env here'
  grep -v '^ADMIN_PASSWORD=' .env >.env.new
  mv .env.new .env
  echo '[bootstrap] ADMIN_PASSWORD removed from .env. Run deploy.sh with the current image to apply it.'
  exit 0
fi

[ $# -eq 2 ] || die 'usage: bootstrap-env.sh <public host name> <admin email>'
host=$1
email=$2
case "$host" in '' | *[!A-Za-z0-9.-]*) die 'the host name takes letters, digits, dots and hyphens only' ;; esac
case "$email" in *[!A-Za-z0-9.@_+-]*) die 'unexpected character in the email' ;; ?*@?*) ;; *) die 'the admin email looks wrong' ;; esac
[ ! -e .env ] || die '.env already exists; nothing changed'

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
postgres_password=$(random_hex 24)
db_password=$(random_hex 24)
backup_password=$(random_hex 24)
# The fixed start satisfies the app's password rule; the rest is random.
admin_password="Pf1-$(random_hex 12)"
[ ${#db_password} -eq 48 ] && [ ${#postgres_password} -eq 48 ] && [ ${#backup_password} -eq 48 ] && [ ${#admin_password} -eq 28 ] ||
  die 'could not read random data'

set -C # fail rather than overwrite
cat >.env <<ENV
PORTFOLIO_HOST=$host
TRUST_PROXY=1
ADMIN_EMAIL=$email
ADMIN_PASSWORD=$admin_password
POSTGRES_PASSWORD=$postgres_password
DB_PASSWORD=$db_password
BACKUP_DB_PASSWORD=$backup_password
DATABASE_URL=postgres://portfolio_app:$db_password@postgres:5432/portfolio
ENV
chmod 600 .env
echo "[bootstrap] wrote $(pwd)/.env (mode 600) with: $(sed -n 's/=.*//p' .env | tr '\n' ' ')"
