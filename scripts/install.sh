#!/usr/bin/env bash
# Install relatime into the user extension dir and queue it for next login.
#
# The UUID is read from metadata.json so there is exactly one source of truth.
# Changing the UUID is the escape hatch for GJS's module cache: a new uuid
# means a new module URL, which has never been imported before, so the shell
# will read it from scratch even if the old one failed to import.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
UUID=$(python3 -c "import json;print(json.load(open('$SRC/metadata.json'))['uuid'])")
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "==> installing $UUID"
mkdir -p "$DEST"
rsync -a --delete \
    --exclude 'node_modules' --exclude 'package.json' --exclude '.git' \
    --exclude 'scripts' --exclude 'TODO.md' --exclude 'test' \
    --exclude 'REFERENCE.md' --exclude 'AGENTS.md' \
    --delete-excluded \
    "$SRC"/ "$DEST"/

echo "==> queueing enable for next login"
# The running shell only knows extensions present at its startup, so
# gnome-extensions enable fails on a fresh install. Pre-arm the key instead.
UUID="$UUID" python3 - <<'PY'
import ast, os, subprocess
uuid = os.environ['UUID']
schema, key = 'org.gnome.shell', 'enabled-extensions'
raw = subprocess.run(['gsettings', 'get', schema, key], capture_output=True, text=True).stdout
# GVariant array output is a valid Python list literal.
items = ast.literal_eval(raw) if raw.strip() else []
stale = [i for i in items if i.startswith('relatime@') and i != uuid]
# Keep other extensions in order, drop stale relatime entries, then ours once.
kept = [i for i in items if i not in stale and i != uuid]
items = kept + [uuid]
value = '[' + ', '.join(f"'{i}'" for i in items) + ']'
subprocess.run(['gsettings', 'set', schema, key, value], check=True)
print(f'    {schema} {key} = {value}')
if stale:
    print(f'    dropped stale uuid(s): {", ".join(stale)}')
PY

# Clean up directories of previous uuids so they cannot fail to load at startup.
for dir in "$HOME"/.local/share/gnome-shell/extensions/relatime@*; do
    [ -d "$dir" ] || continue
    [ "$(basename "$dir")" = "$UUID" ] && continue
    echo "==> removing stale install $(basename "$dir")"
    rm -rf "$dir"
done

echo
echo "Done. From here on, edit impl.js or src/relatime.js and run:"
echo "  ./scripts/reload.sh        (no restart)"
echo
echo "A logout/login is needed only if extension.js changed (it is a module that"
echo "GJS caches forever) or if the extension is in ERROR state - reload.sh says so."
echo "This is a Wayland session, so use: gnome-session-quit --logout --no-prompt"