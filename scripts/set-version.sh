#!/bin/bash
set -e

for DIR_ITEM in $(yarn workspaces list --json | jq -r '.location'); do
  DIR=$(echo -n "$DIR_ITEM" | tr -d '\r\n')
  if [ -f "$DIR/package.json" ]; then
    echo "Setting version for $DIR"
    jq ".version = \"$1\"" "$DIR"/package.json > tmp.json && mv tmp.json "$DIR"/package.json
  else
    echo "No package.json found in: $DIR"
  fi
done
