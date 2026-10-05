#!/usr/bin/env bash
# Post-restart check: is the extension loaded, and did it log any errors?
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UUID=$(python3 -c "import json;print(json.load(open('$HERE/../metadata.json'))['uuid'])")

echo "== enabled =="
gnome-extensions list --enabled | grep -F "$UUID" || echo "  NOT enabled"

echo "== info =="
gnome-extensions info "$UUID" 2>&1 | sed 's/^/  /'

echo "== errors over D-Bus =="
# This setup journals no extension errors, and GJS caches modules, so
# disable+enable will NOT re-read edited files.
gdbus call --session --dest org.gnome.Shell.Extensions \
    --object-path /org/gnome/Shell/Extensions \
    --method org.gnome.Shell.Extensions.GetExtensionErrors "$UUID" 2>&1 \
    | grep -qvE '^\((@as )?\[\],\)$' || echo "  none"

echo "== log from THIS shell session only =="
# The full journal keeps old sessions' errors around and makes a healthy
# extension look broken; scope to the running shell's start time.
ages=$(ps -o etimes= -p "$(pgrep -x gnome-shell | head -1)" | tr -d " ")
since=$(date -d "-${ages} seconds" "+%Y-%m-%d %H:%M:%S")
log=$(journalctl --user -o cat --since "$since" 2>/dev/null | grep -i relatime)
if [ -n "$log" ]; then
    echo "$log" | tail -10 | sed 's/^/  /'
else
    echo "  (nothing)"
fi

echo
echo "If the panel shows a blue/green/red clock, it worked."
echo "Toggle it off/on with:  gnome-extensions disable|enable $UUID"
echo "NOTE: impl.js and src/relatime.js hot-reload; only extension.js is"
echo "      frozen by the module cache and would need a logout."