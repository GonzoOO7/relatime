#!/usr/bin/env bash
# The dev loop: install the current sources and re-enable, no shell restart.
#
# Works because extension.js is a tiny shim that eval-loads impl.js on every
# enable, bypassing the GJS module cache. impl.js must therefore not use
# `import` statements - everything arrives via deps.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UUID=$(python3 -c "import json;print(json.load(open('$HERE/../metadata.json'))['uuid'])")

"$HERE/install.sh" >/dev/null

echo "==> re-enabling"
state=$(gnome-extensions info "$UUID" 2>/dev/null | sed -n 's/^ *State: //p')

# GNOME's state machine cannot recover an ERROR extension: _callExtensionEnable
# bails unless the state is INACTIVE, and _callExtensionDisableWithRebase bails
# unless it is ACTIVE. So disable+enable on a broken extension is a no-op and
# only a shell restart will load it again. Say so instead of failing silently.
if [[ "$state" == "ERROR" ]]; then
    echo "  State: ERROR - the running shell cannot recover this (GNOME bug, not ours)."
    echo "  Fix the code, re-run install.sh, then log out and back in."
    gdbus call --session --dest org.gnome.Shell.Extensions \
        --object-path /org/gnome/Shell/Extensions \
        --method org.gnome.Shell.Extensions.GetExtensionErrors "$UUID"
    exit 2
fi

gnome-extensions disable "$UUID" || true
# The settings-changed handler that actually loads and unloads extensions is
# async, so a too-short gap gets both writes coalesced into no change at all.
sleep 1.5
gnome-extensions enable "$UUID" || true

# Poll rather than sleep: enable() lands whenever the handler gets round to it,
# and reading the state too early looks exactly like a failed reload.
for _ in $(seq 1 20); do
    sleep 0.5
    state=$(gnome-extensions info "$UUID" 2>/dev/null | sed -n 's/^ *State: //p')
    [[ "$state" == "ACTIVE" ]] && break
done
errors=$(gdbus call --session --dest org.gnome.Shell.Extensions \
    --object-path /org/gnome/Shell/Extensions \
    --method org.gnome.Shell.Extensions.GetExtensionErrors "$UUID" 2>&1)

echo "  State: ${state:-unknown}"
# GetExtensionErrors answers with a list; "(['...'],)" means it has entries.
if grep -qvE '^\((@as )?\[\],\)$' <<<"$errors"; then
    echo "  ERRORS: $errors"
else
    echo "  errors: none"
fi
[[ "$state" == "ACTIVE" ]] && echo "  loaded cleanly - check the panel"