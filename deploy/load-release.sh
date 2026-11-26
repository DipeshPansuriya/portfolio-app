#!/bin/sh
# Loads the release image made by the build agent into this Docker (pipeline stage 9).
# The archive is not trusted: `docker load` sets whatever names an archive carries.
#   sh load-release.sh <archive> <image name:tag> <image ID recorded at gate 8>
# Refused, with nothing loaded, if this Docker holds another image under that name (a
# released tag is not replaced), or unless the archive holds exactly that one image:
#   - the name is a release tag of IMAGE_REPO (scripts/ci.sh, stashed before repository code);
#   - every member is an expected plain file, given once, and each blob matches its name;
#   - index.json is byte for byte one image, that name, the recorded ID;
#     manifest.json lists that one name.
# Docker gets a new archive made here from the checked files, never the one received.
# Both Docker daemons need the containerd image store: the ID differs otherwise. If Docker
# then reports another result, or an image for another processor than its own, the name goes
# back to what it was and this fails.
set -eu
umask 077
die() { echo "[load] $*" >&2; exit 1; }

[ $# -eq 3 ] || die 'usage: load-release.sh <archive> <name:tag> <image ID>'
archive=$1
image=$2
want=$3
here="$(cd "$(dirname "$0")" && pwd)"

# Character checks come first: they refuse line breaks, which grep would take line by line.
repo="$(sed -n 's/^IMAGE_REPO=//p' "$here/../scripts/ci.sh")"
case "$repo" in '' | *[!a-z0-9./_-]*) die 'scripts/ci.sh must name IMAGE_REPO once' ;; esac
tag="${image#"$repo":}"
[ "$tag" != "$image" ] || die "the image name is not a tag of $repo"
case "$tag" in *[!0-9a-z.-]*) die 'unexpected character in the image tag' ;; esac
printf '%s\n' "$tag" | grep -qxE '[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{8,40}(-dirty)?' ||
  die 'the image tag is not <version>-<commit>'
hex="${want#sha256:}"
case "$hex" in *[!0-9a-f]*) die 'the recorded image ID is not a sha256 digest' ;; esac
[ "sha256:$hex" = "$want" ] && [ ${#hex} -eq 64 ] || die 'the recorded image ID is not a sha256 digest'
[ -f "$archive" ] && [ ! -L "$archive" ] || die 'no archive file'
store="$(docker info -f '{{.DriverStatus}}')" || die 'Docker does not answer'
case "$store" in
  *io.containerd.snapshotter.*) ;;
  *) die 'this Docker does not use the containerd image store' ;;
esac

work="$(mktemp -d "${TMPDIR:-/tmp}/portfolio-load.XXXXXX")"
trap 'rm -rf "${work:?}"' EXIT
trap 'exit 130' INT TERM
files="$work/image"
mkdir -p "$files/blobs/sha256"

# Members: plain files and folders, expected names only, each once.
tar -tf "$archive" >"$work/names" || die 'the archive cannot be read'
tar -tvf "$archive" >"$work/long" || die 'the archive cannot be read'
! grep -qv '^[-d]' "$work/long" || die 'the archive holds something other than files and folders'
! grep -qvxE 'blobs/|blobs/sha256/|blobs/sha256/[0-9a-f]{64}|index\.json|manifest\.json|oci-layout' "$work/names" ||
  die 'the archive holds an unexpected member'
[ -z "$(sort "$work/names" | uniq -d)" ] || die 'the archive holds a member twice'
[ "$(wc -l <"$work/names")" -le 200 ] || die 'the archive holds too many members'
for name in index.json manifest.json oci-layout; do
  grep -qxF "$name" "$work/names" || die "the archive lacks $name"
done

# Each file is read to a path made here: the archive never writes to the disk itself.
member() { tar -xOf "$archive" "$1" >"$2" || die "cannot read $1 from the archive"; }
digest_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum <"$1"; else shasum -a 256 <"$1"; fi | cut -d ' ' -f 1
}
grep -xE 'blobs/sha256/[0-9a-f]{64}' "$work/names" >"$work/blobs" || die 'the archive holds no image data'
while read -r name; do
  member "$name" "$files/$name"
  [ "$(digest_of "$files/$name")" = "${name##*/}" ] || die 'a blob does not match its name'
done <"$work/blobs"
member index.json "$files/index.json"
member manifest.json "$work/manifest.json"

blob="$files/blobs/sha256/$hex"
[ -f "$blob" ] || die 'the archive does not hold the image recorded at gate 8'
size="$(wc -c <"$blob" | tr -d ' ')"
# Neither file is parsed: each must match a whole expected text, so another name, image, key
# or spelling is refused. manifest.json first (not given to Docker; another name in it still
# means the archive was changed): one image, this name alone.
one='"blobs/sha256/[0-9a-f]{64}"'
pattern="\\[\\{\"Config\":$one,\"RepoTags\":\\[\"$(printf '%s' "$image" | sed 's/\./\\./g')\"\\],\"Layers\":\\[$one(,$one)*\\]\\}\\]"
[ "$(wc -l <"$work/manifest.json" | tr -d ' ')" = 0 ] && grep -qxE "$pattern" "$work/manifest.json" ||
  die "manifest.json must list $image alone"
config="$(sed 's|^\[{"Config":"blobs/sha256/\([0-9a-f]*\)".*|\1|' "$work/manifest.json")"
# index.json, with or without the configuration's digest (a built image records it).
same=
for type in application/vnd.oci.image.manifest.v1+json application/vnd.docker.distribution.manifest.v2+json; do
  for extra in '' "\"config.digest\":\"sha256:$config\","; do
    printf '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[{"mediaType":"%s","digest":"%s","size":%s,"annotations":{%s"io.containerd.image.name":"%s","org.opencontainers.image.ref.name":"%s"}}]}' \
      "$type" "$want" "$size" "$extra" "$image" "$tag" >"$work/expected"
    ! cmp -s "$work/expected" "$files/index.json" || same=1
  done
done
[ -n "$same" ] || die "index.json must name exactly $image as the image $want"

printf '{"imageLayoutVersion":"1.0.0"}' >"$files/oci-layout"
before="$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null)" || before=
[ -z "$before" ] || [ "$before" = "$want" ] ||
  die "$image already holds another image here ($before): a released tag is not replaced, release a new commit"
server="$(docker version -f '{{.Server.Os}}/{{.Server.Arch}}')" || die 'Docker does not name its processor'
put_back() {
  if [ -n "$before" ]; then
    docker tag "$before" "$image" || echo "[load] WARNING: $image could not be set back to $before" >&2
  elif docker image inspect -f '{{.Id}}' "$image" >/dev/null 2>&1; then
    docker image rm "$image" >/dev/null || echo "[load] WARNING: $image could not be removed" >&2
  fi
}
if ! out="$(COPYFILE_DISABLE=1 tar -cf - -C "$files" oci-layout index.json blobs | docker load)"; then
  put_back
  die 'docker load failed'
fi
have="$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null)" || have=
if [ "$out" != "Loaded image: $image" ] || [ "$have" != "$want" ]; then
  printf '%s\n' "$out" >&2
  put_back
  die "Docker did not load exactly $image as $want (it reports ${have:-no image})"
fi
platform="$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null)" || platform=
if [ "$platform" != "$server" ]; then
  put_back
  die "the image is built for ${platform:-an unknown platform}, this server is $server: build it on that platform"
fi
echo "[load] loaded $image, ID $want, as recorded at gate 8"
