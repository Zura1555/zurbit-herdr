#!/bin/sh
# Link the Zurbit layout and mods into the Herdr app home.
# Usage: sh herdr-app/install.sh   (HERDR_APP_HOME overrides the default)
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

mkdir -p "$APP_HOME/layouts" "$APP_HOME/mods"

ln -sfn "$HERE/layouts/zurbit.json" "$APP_HOME/layouts/zurbit.json"
for m in "$HERE"/mods/*/; do
	name=$(basename "$m")
	ln -sfn "$m" "$APP_HOME/mods/$name"
done

echo "linked layout + mods → $APP_HOME"
if command -v herdr-app >/dev/null 2>&1; then
	herdr-app check "$APP_HOME/mods/zurbit-factory"
else
	echo "herdr-app not on PATH — run 'herdr-app check $APP_HOME/mods/zurbit-factory' to validate"
fi
