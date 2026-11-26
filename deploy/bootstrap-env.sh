#!/bin/sh
# Writes the server's .env with new random secrets, once. Prints names, never values.
#   sh bootstrap-env.sh <public host name> <admin email>                  own PostgreSQL
#                       the host without www (for example the main domain): www redirects to it
#   sh bootstrap-env.sh --shared-db <db host> <db network> <host> <email> shared PostgreSQL
#                       DB_PORT=<port> in front when it does not listen on 5432
#   TRUSTED_PROXY_IPS=<address or subnet of Traefik> in front of either; without it the
#                       name is written empty and deploy.sh refuses until it is filled in
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

db_host=
db_network=
db_port="${DB_PORT:-5432}"
case "$db_port" in '' | *[!0-9]*) die 'DB_PORT is a number' ;; esac
proxies="${TRUSTED_PROXY_IPS:-}"
case "$proxies" in *[!0-9A-Fa-f.:/,]*) die 'TRUSTED_PROXY_IPS takes addresses and subnets, commas between, no spaces' ;; esac
if [ "${1:-}" = --shared-db ]; then
  [ $# -eq 5 ] || die 'usage: bootstrap-env.sh --shared-db <db host> <db network> <public host name> <admin email>'
  db_host=$2
  db_network=$3
  shift 3
  case "$db_host" in '' | -* | *[!A-Za-z0-9._-]*) die 'unexpected character in the database host' ;; esac
  case "$db_network" in '' | -* | *[!A-Za-z0-9._-]*) die 'unexpected character in the database network' ;; esac
fi
[ $# -eq 2 ] || die 'usage: bootstrap-env.sh <public host name> <admin email>'
host=$1
email=$2
case "$host" in '' | *[!A-Za-z0-9.-]*) die 'the host name takes letters, digits, dots and hyphens only' ;; esac
case "$host" in [Ww][Ww][Ww].*) die 'give the host without www: www redirects to it' ;; esac
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

# A shared server keeps its own superuser password: none is written for it.
database() {
  if [ -z "$db_host" ]; then
    echo "POSTGRES_PASSWORD=$postgres_password"
    echo "DATABASE_URL=postgres://portfolio_app:$db_password@postgres:5432/portfolio"
  else
    echo 'COMPOSE_FILE=compose.yaml:compose.shared-db.yaml'
    echo "DB_HOST=$db_host"
    echo "DB_NETWORK=$db_network"
    echo "DB_PORT=$db_port"
    echo "DATABASE_URL=postgres://portfolio_app:$db_password@$db_host:$db_port/portfolio"
  fi
}

set -C # fail rather than overwrite
cat >.env <<ENV
PORTFOLIO_HOST=$host
TRUST_PROXY=1
TRUSTED_PROXY_IPS=$proxies
ADMIN_EMAIL=$email
ADMIN_PASSWORD=$admin_password
DB_PASSWORD=$db_password
BACKUP_DB_PASSWORD=$backup_password
$(database)
ENV
chmod 600 .env
echo "[bootstrap] wrote $(pwd)/.env (mode 600) with: $(sed -n 's/=.*//p' .env | tr '\n' ' ')"
[ -n "$proxies" ] || echo '[bootstrap] set TRUSTED_PROXY_IPS in .env to the reverse proxy address: deploy.sh refuses without it'
