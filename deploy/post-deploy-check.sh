#!/bin/sh
# Checks the running stack after a deploy; exit 1 on any failure.
#   sh post-deploy-check.sh [expected image]
#   COMPOSE_PROJECT   default portfolio
#   PUBLIC_CHECK=1    also ask https://$PORTFOLIO_HOST/api/ready (from .env; needs DNS and TLS)
set -eu
cd "$(dirname "$0")"
PROJECT="${COMPOSE_PROJECT:-portfolio}"
failed=0
expect() { # <label> <value> <wanted shell pattern>
  # shellcheck disable=SC2254 # a pattern is meant
  case "$2" in
    $3) echo "ok   $1: $2" ;;
    *) echo "FAIL $1: '$2'" >&2; failed=1 ;;
  esac
}

id="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
  --filter label=com.docker.compose.service=app --filter label=com.docker.compose.oneoff=False)"
[ -n "$id" ] || { echo "FAIL no running app container in project $PROJECT" >&2; exit 1; }
look() { docker inspect -f "$1" "$id"; }

[ $# -eq 0 ] || expect 'image' "$(look '{{.Config.Image}}')" "$1"
expect 'health' "$(look '{{.State.Health.Status}}')" healthy
expect 'user' "$(docker exec "$id" id -u)" '[1-9]*'
expect 'read-only root' "$(look '{{.HostConfig.ReadonlyRootfs}}')" true
expect 'memory limit (bytes)' "$(look '{{.HostConfig.Memory}}')" '[1-9]*'
expect 'cpu limit (nano)' "$(look '{{.HostConfig.NanoCpus}}')" '[1-9]*'
expect 'capabilities dropped' "$(look '{{.HostConfig.CapDrop}}')" '*ALL*'
expect 'privileges' "$(look '{{.HostConfig.SecurityOpt}}')" '*no-new-privileges*'
expect 'published ports' "[$(look '{{range $port, $to := .HostConfig.PortBindings}}{{$port}} {{end}}')]" '\[\]'
expect 'log rotation' "$(look '{{index .HostConfig.LogConfig.Config "max-size"}}')" '[1-9]*'
expect 'sign-in rate limit' "$(look '{{index .Config.Labels "traefik.http.routers.portfolio-auth.middlewares"}}')" \
  'portfolio-auth-source,portfolio-auth-total'

# The database: uid 70 (its entrypoint then never runs gosu), no published port, and only
# an internal network that holds nothing but this project's containers.
db="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
  --filter label=com.docker.compose.service=postgres --filter label=com.docker.compose.oneoff=False)"
if [ -n "$db" ]; then
  data="${PROJECT}_portfolio-data"
  of_db() { docker inspect -f "$1" "$db"; }
  expect 'database user' "$(of_db '{{.Config.User}}')" 70:70
  expect 'database published ports' "[$(of_db '{{range $port, $to := .HostConfig.PortBindings}}{{$port}} {{end}}')]" '\[\]'
  expect 'database networks' "$(of_db '{{range $name, $to := .NetworkSettings.Networks}}{{$name}} {{end}}')" "$data "
  expect 'database network internal' "$(docker network inspect -f '{{.Internal}}' "$data")" true
  strangers=
  for member in $(docker network inspect -f '{{range $cid, $c := .Containers}}{{$cid}} {{end}}' "$data"); do
    # A one-off container can leave between the two calls: it is no longer a member.
    owner="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$member" 2>/dev/null)" ||
      continue
    [ "$owner" = "$PROJECT" ] || strangers="$strangers $member"
  done
  expect 'database network members from elsewhere' "[$strangers]" '\[\]'
else
  echo "FAIL no running postgres container in project $PROJECT" >&2
  failed=1
fi
docker exec -i "$id" node --input-type=module - <checks/probe.mjs || failed=1

if [ "${PUBLIC_CHECK:-0}" = 1 ]; then
  host="$(sed -n 's/^PORTFOLIO_HOST=//p' .env | tail -n 1)"
  if wget -q -T 20 -O /dev/null "https://$host/api/ready"; then
    echo "ok   public https://$host/api/ready"
  else
    echo "FAIL public https://$host/api/ready" >&2
    failed=1
  fi
fi
exit "$failed"
