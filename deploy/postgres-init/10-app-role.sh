#!/bin/sh
# Runs by itself on the first start of an empty data volume (docker-entrypoint-initdb.d).
# It is never retried by the image: after a failed first start, run it by hand (README).
# Safe to run again: it creates only what is missing and never changes an existing password.
# portfolio_owner (cannot sign in) owns the database `portfolio`, so no signed-in role can
# drop it. portfolio_app creates and uses the tables. portfolio_backup only reads them, for
# the dump and restore-test jobs; that rests on its grants (the read-only setting on the role
# is only a default, which the role itself can turn off).
# Nothing is changed unless every check passes:
#   - PostgreSQL 15, 16 or 17;
#   - an existing database `portfolio` belongs to portfolio_owner;
#   - an existing role of these three names was made by this script (its comment says
#     `portfolio`), has no extra attribute or membership and owns no other database.
#   SHARED_SERVER=1   run by hand by the administrator (superuser) of a shared server
#                     (README): nothing of the server or of other databases is changed, and
#                     the backup role gets SELECT in the portfolio database only, never
#                     pg_read_all_data, which would let it read every database it can
#                     connect to. Also refused while PUBLIC (so these roles too) may connect
#                     to another application's database, or create in any schema it can reach.
#   SHARED_ACCEPT_PUBLIC=1   the server's owner has read that list and accepts it.
set -eu
: "${DB_PASSWORD:?set DB_PASSWORD}"
: "${BACKUP_DB_PASSWORD:?set BACKUP_DB_PASSWORD}"
case "${SHARED_SERVER:-0}" in 0 | 1) ;; *) echo 'SHARED_SERVER is 0 or 1' >&2; exit 1 ;; esac
case "${SHARED_ACCEPT_PUBLIC:-0}" in 0 | 1) ;; *) echo 'SHARED_ACCEPT_PUBLIC is 0 or 1' >&2; exit 1 ;; esac

query() { # <database> <sql>
  PGDATABASE="$1" psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" -XqtAc "$2"
}

# One line for each reason to refuse; nothing for a clean server.
refusals="$(query postgres "
  WITH ours AS (
    SELECT * FROM pg_roles WHERE rolname IN ('portfolio_owner', 'portfolio_app', 'portfolio_backup')
  )
  SELECT 'PostgreSQL ' || current_setting('server_version') || ': 15, 16 or 17 is needed'
   WHERE current_setting('server_version_num')::int NOT BETWEEN 150000 AND 179999
  UNION ALL
  SELECT 'the database portfolio belongs to ' || pg_get_userbyid(datdba) || ', not to portfolio_owner'
    FROM pg_database WHERE datname = 'portfolio' AND pg_get_userbyid(datdba) <> 'portfolio_owner'
  UNION ALL
  SELECT 'the role ' || rolname || ' exists and was not made by this script, or has extra attributes'
    FROM ours
   WHERE shobj_description(oid, 'pg_authid') IS DISTINCT FROM 'portfolio'
      OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
      OR rolcanlogin <> (rolname <> 'portfolio_owner')
  UNION ALL
  SELECT 'the role ' || o.rolname || ' is a member of ' || pg_get_userbyid(m.roleid)
    FROM ours o JOIN pg_auth_members m ON m.member = o.oid
   WHERE NOT (o.rolname = 'portfolio_backup' AND pg_get_userbyid(m.roleid) = 'pg_read_all_data'
              AND '${SHARED_SERVER:-0}' = '0')
  UNION ALL
  SELECT 'the role ' || o.rolname || ' owns another database: ' || d.datname
    FROM ours o JOIN pg_database d ON d.datdba = o.oid WHERE d.datname <> 'portfolio'")"
[ -z "$refusals" ] || { printf 'refused, nothing was changed:\n%s\n' "$refusals" >&2; exit 1; }

if [ "${SHARED_SERVER:-0}" = 1 ]; then
  reachable="$(query postgres "SELECT datname FROM pg_database
    WHERE datallowconn AND datname <> 'portfolio' AND has_database_privilege('public', oid, 'CONNECT')
    ORDER BY datname")"
  open=
  while IFS= read -r db; do
    [ -n "$db" ] || continue
    case "$db" in
      # The server's own two databases: PostgreSQL's default, reported only.
      postgres | template1) echo "note: PUBLIC may connect to $db (server default)" ;;
      *) open="$open
REVOKE CONNECT, TEMPORARY ON DATABASE \"$db\" FROM PUBLIC;" ;;
    esac
    schemas="$(query "$db" "SELECT format('in database %I: REVOKE CREATE ON SCHEMA %I FROM PUBLIC;', current_database(), nspname)
      FROM pg_namespace WHERE nspname !~ '^pg_(temp|toast)' AND has_schema_privilege('public', oid, 'CREATE')")"
    [ -z "$schemas" ] || open="$open
$schemas"
  done <<EOF
$reachable
EOF
  if [ -n "$open" ]; then
    printf 'PUBLIC grants that the portfolio roles would get too. Only the server owner may change them:%s\n' "$open" >&2
    [ "${SHARED_ACCEPT_PUBLIC:-0}" = 1 ] || {
      echo 'refused, nothing was changed (SHARED_ACCEPT_PUBLIC=1 only with the server owner'\''s yes)' >&2
      exit 1
    }
    echo 'accepted by SHARED_ACCEPT_PUBLIC=1' >&2
  fi
fi

# \getenv keeps the passwords out of the process list.
psql -v ON_ERROR_STOP=1 -v shared="${SHARED_SERVER:-0}" --username "${POSTGRES_USER:-postgres}" --dbname postgres <<'SQL'
\getenv app_password DB_PASSWORD
\getenv backup_password BACKUP_DB_PASSWORD
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_owner') AS missing \gset
\if :missing
  BEGIN;
  CREATE ROLE portfolio_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  COMMENT ON ROLE portfolio_owner IS 'portfolio';
  COMMIT;
\endif
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_app') AS missing \gset
\if :missing
  BEGIN;
  CREATE ROLE portfolio_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
  COMMENT ON ROLE portfolio_app IS 'portfolio';
  COMMIT;
\endif
-- The app's pool is 5 (compose.yaml); the rest is for the scripts run inside the container.
ALTER ROLE portfolio_app CONNECTION LIMIT 10;
SELECT NOT EXISTS (SELECT FROM pg_database WHERE datname = 'portfolio') AS missing \gset
\if :missing
  CREATE DATABASE portfolio OWNER portfolio_owner;
\endif
REVOKE ALL ON DATABASE portfolio FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE portfolio TO portfolio_app;
\if :shared
\else
  REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
  REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
\endif
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_backup') AS missing \gset
\if :missing
  BEGIN;
  CREATE ROLE portfolio_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    CONNECTION LIMIT 3 PASSWORD :'backup_password';
  COMMENT ON ROLE portfolio_backup IS 'portfolio';
  COMMIT;
\endif
GRANT CONNECT ON DATABASE portfolio TO portfolio_backup;
ALTER ROLE portfolio_backup SET default_transaction_read_only = on;
\if :shared
\else
  GRANT pg_read_all_data TO portfolio_backup;
\endif
\connect portfolio
GRANT USAGE, CREATE ON SCHEMA public TO portfolio_app;
\if :shared
  GRANT USAGE ON SCHEMA public TO portfolio_backup;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO portfolio_backup;
  GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO portfolio_backup;
  -- And what the app creates later.
  ALTER DEFAULT PRIVILEGES FOR ROLE portfolio_app IN SCHEMA public GRANT SELECT ON TABLES TO portfolio_backup;
  ALTER DEFAULT PRIVILEGES FOR ROLE portfolio_app IN SCHEMA public GRANT SELECT ON SEQUENCES TO portfolio_backup;
\endif
SQL
