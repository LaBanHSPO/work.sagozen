#!/bin/sh
# Build Linux bindings locally and save them in the checkout for later image builds.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
arch=${1:-$(docker info --format '{{.Architecture}}')}
case "$arch" in
  amd64|x86_64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "Usage: sh .docker/selfhost/build-native.sh [amd64|arm64]" >&2; exit 1 ;;
esac
if [ "$#" -gt 0 ]; then shift; fi

# Extra arguments may set the existing Cargo job/LTO/public-key build options.
docker buildx build \
  --platform "linux/$arch" \
  --file "$root/.docker/selfhost/Dockerfile" \
  --target native-export \
  --output "type=local,dest=$root/.docker/selfhost/native/$arch" \
  "$@" "$root"

printf 'Saved Linux %s bindings. Build the image with:\n' "$arch"
printf 'NATIVE_SOURCE=prebuilt docker compose -f .docker/selfhost/compose.yml build affine\n'
