#!/bin/sh
# Runs by itself on the first start of an empty data volume (docker-entrypoint-initdb.d).
# It is never retried by the image: after a failed first start, run it by hand (README).
# Safe to run again: it creates only what is missing and never changes an existing password.
# portfolio_app owns one database and nothing else (ADR 0005). portfolio_backup only reads
# it, for the dump and restore-test jobs.
set -eu
: "${DB_PASSWORD:?set DB_PASSWORD}"
: "${BACKUP_DB_PASSWORD:?set BACKUP_DB_PASSWORD}"
# \getenv keeps the passwords out of the process list.
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres <<'SQL'
\getenv app_password DB_PASSWORD
\getenv backup_password BACKUP_DB_PASSWORD
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_app') AS missing \gset
\if :missing
  CREATE ROLE portfolio_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
\endif
SELECT NOT EXISTS (SELECT FROM pg_database WHERE datname = 'portfolio') AS missing \gset
\if :missing
  CREATE DATABASE portfolio OWNER portfolio_app;
\endif
REVOKE ALL ON DATABASE portfolio FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
-- From template1 the app role could otherwise drop its own database.
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'portfolio_backup') AS missing \gset
\if :missing
  CREATE ROLE portfolio_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    CONNECTION LIMIT 3 PASSWORD :'backup_password';
\endif
GRANT CONNECT ON DATABASE portfolio TO portfolio_backup;
GRANT pg_read_all_data TO portfolio_backup;
ALTER ROLE portfolio_backup SET default_transaction_read_only = on;
SQL
