#!/bin/sh
# Link the Zurbit layout and mods into the Herdr app home.
# Usage: sh herdr-app/install.sh   (HERDR_APP_HOME overrides the default)
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

mkdir -p "$APP_HOME/layouts" "$APP_HOME/mods"

for l in "$HERE"/layouts/*.json; do
	name=$(basename "$l")
	ln -sfn "$l" "$APP_HOME/layouts/$name"
done
for m in "$HERE"/mods/*/; do
	name=$(basename "$m")
	ln -sfn "$m" "$APP_HOME/mods/$name"
done

echo "linked layouts + mods → $APP_HOME"
if command -v herdr-app >/dev/null 2>&1; then
	herdr-app check "$APP_HOME/mods/zurbit-factory"
else
	echo "herdr-app not on PATH — run 'herdr-app check $APP_HOME/mods/zurbit-factory' to validate"
fi
