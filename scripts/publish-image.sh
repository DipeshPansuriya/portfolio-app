#!/bin/sh
# Pushes the image the build job checked to the registry, once per tag
# (.github/workflows/publish-image.yml, job "push"). Runs no build code.
#   sh scripts/publish-image.sh <archive written by `docker save`>
#   IMAGE           <repository>:<version>-<commit>, the name scripts/ci.sh gave it
#   IMAGE_ID        the ID of the image gate 8 ran
#   ARCHIVE_SHA256  checksum of the archive, taken by the build job
#   GHCR_USER       registry user; GHCR_TOKEN its token (may write packages)
#   GITHUB_SHA      the commit of this run; the tag must name it
#   DIGEST_FILE     optional: gets <name:tag>@sha256:<digest>
# Refused, with nothing pushed, unless the registry answers that the tag is free: any
# other answer than "not found" stops it. The registry itself does not lock a tag, so
# the workflow runs one publish at a time.
set -eu
umask 077
die() { echo "[publish] $*" >&2; exit 1; }

[ $# -eq 1 ] || die 'usage: publish-image.sh <archive>'
archive=$1
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(sed -n 's/^IMAGE_REPO=//p' "$here/ci.sh")"
case "$repo" in ghcr.io/*) ;; *) die 'scripts/ci.sh must name a ghcr.io IMAGE_REPO' ;; esac
case "$repo" in *[!a-z0-9./_-]*) die 'scripts/ci.sh must name IMAGE_REPO once' ;; esac
path="${repo#ghcr.io/}"

image="${IMAGE:-}"
tag="${image#"$repo":}"
[ "$tag" != "$image" ] || die "the image name is not a tag of $repo"
# Characters first: this also refuses line breaks, which grep would take line by line.
case "$tag" in *[!0-9a-f.-]*) die 'the image tag is not <version>-<commit>' ;; esac
printf '%s\n' "$tag" | grep -qxE '[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{8,40}' ||
  die 'the image tag is not <version>-<commit> of a clean checkout'
case "${GITHUB_SHA:-}" in "${tag##*-}"*) ;; *) die 'the tag does not name the commit of this run (GITHUB_SHA)' ;; esac
is_digest() { case "${1#sha256:}" in "$1" | *[!0-9a-f]*) return 1 ;; esac; [ ${#1} -eq 71 ]; }
is_digest "${IMAGE_ID:-}" || die 'IMAGE_ID is not a sha256 digest'
[ -n "${GHCR_USER:-}" ] && [ -n "${GHCR_TOKEN:-}" ] || die 'GHCR_USER and GHCR_TOKEN are needed'

[ -f "$archive" ] || die 'no archive file'
sum="$(if command -v sha256sum >/dev/null 2>&1; then sha256sum <"$archive"; else shasum -a 256 <"$archive"; fi | cut -d ' ' -f 1)"
[ "$sum" = "${ARCHIVE_SHA256:-}" ] || die 'the archive is not the one the build job wrote'
docker load -i "$archive" >/dev/null || die 'docker load failed'
have="$(docker image inspect -f '{{.Id}}' "$image")" || die "the archive holds no image $image"
[ "$have" = "$IMAGE_ID" ] || die "$image is $have, gate 8 ran $IMAGE_ID"
platform="$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image")" || die 'cannot read the platform'
[ "$platform" = linux/amd64 ] || die "the image is built for $platform, the server is linux/amd64"

# Secrets reach curl on its standard input, never on a command line.
answer="$(printf 'user = "%s:%s"\n' "$GHCR_USER" "$GHCR_TOKEN" |
  curl -fsS --max-time 30 --config - "https://ghcr.io/token?service=ghcr.io&scope=repository:$path:pull,push")" ||
  die 'the registry gave no access token; nothing pushed'
bearer="$(printf '%s' "$answer" | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')"
[ -n "$bearer" ] || die 'the registry gave no access token; nothing pushed'
accept='application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json'
manifest_headers() { # the registry's answer for this tag, headers only
  printf 'header = "Authorization: Bearer %s"\n' "$bearer" |
    curl -sS --max-time 30 --config - --head -H "Accept: $accept" "https://ghcr.io/v2/$path/manifests/$tag" |
    tr -d '\r'
}
status_of() { printf '%s\n' "$1" | sed -n 's/^HTTP\/[0-9.]* \([0-9]\{3\}\).*/\1/p' | tail -n 1; }

headers="$(manifest_headers)" || die 'the registry cannot be asked about the tag; nothing pushed'
status="$(status_of "$headers")"
case "$status" in
  404) ;;
  200) die "$image already exists: a released tag is never overwritten, release a new commit" ;;
  *) die "cannot tell whether $image exists (registry answer: ${status:-none}); nothing pushed" ;;
esac

trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
trap 'exit 130' INT TERM
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null || die 'sign-in failed'
docker push "$image" || die "the push of $image failed"

# The digest as Docker recorded it and as the registry serves the tag: both must agree.
headers="$(manifest_headers)" || die 'pushed, but the registry cannot be asked for the digest'
[ "$(status_of "$headers")" = 200 ] || die 'pushed, but the registry does not serve the tag'
served="$(printf '%s\n' "$headers" | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: *//p' | tail -n 1)"
is_digest "$served" || die 'pushed, but the registry named no digest'
docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$image" | grep -qxF "$repo@$served" ||
  die "pushed, but the registry serves $served, which Docker did not push"

release="$image@$served"
[ -z "${DIGEST_FILE:-}" ] || echo "$release" >"$DIGEST_FILE"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] ||
  printf 'Released image (deploy exactly this):\n\n    %s\n\nImage ID: %s\n' "$release" "$IMAGE_ID" >>"$GITHUB_STEP_SUMMARY"
echo "[publish] pushed $release"
