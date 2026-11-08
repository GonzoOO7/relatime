#!/usr/bin/env bash
# One-shot installer for relatime on any machine.
#
#   curl -fsSL https://raw.githubusercontent.com/GonzoOO7/relatime/main/install.sh | bash
#
# or, from a checkout:  ./install.sh
#
# Downloads the repo (no git needed) unless run from inside a checkout, then
# delegates to scripts/install.sh, which stays the single source of truth for
# what gets copied and how the extension is enabled.
#
# Env: RELATIME_REF=<branch|tag>  (default: main)
set -euo pipefail

REPO="GonzoOO7/relatime"
REF="${RELATIME_REF:-main}"

die() { echo "error: $*" >&2; exit 1; }

# --- preflight --------------------------------------------------------------
for cmd in python3 rsync gsettings tar; do
    command -v "$cmd" >/dev/null || die "'$cmd' is required but not installed"
done

if command -v gnome-shell >/dev/null; then
    ver=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
    case "$ver" in
        50|51) ;;
        *) echo "warning: GNOME Shell $ver detected; relatime declares 50/51 only" \
                "and the shell will refuse to load it." >&2 ;;
    esac
else
    echo "warning: gnome-shell not found; installing anyway." >&2
fi

# --- locate or fetch sources ------------------------------------------------
# BASH_SOURCE is empty / "bash" when piped through curl | bash.
SELF="${BASH_SOURCE[0]:-}"
SRC=""
if [ -n "$SELF" ] && [ -f "$SELF" ]; then
    here="$(cd "$(dirname "$SELF")" && pwd)"
    [ -f "$here/scripts/install.sh" ] && [ -f "$here/metadata.json" ] && SRC="$here"
fi

if [ -z "$SRC" ]; then
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    url="https://codeload.github.com/$REPO/tar.gz/$REF"
    echo "==> downloading $REPO@$REF"
    if command -v curl >/dev/null; then
        curl -fsSL "$url" | tar -xz -C "$TMP" --strip-components=1
    elif command -v wget >/dev/null; then
        wget -qO- "$url" | tar -xz -C "$TMP" --strip-components=1
    else
        die "need curl or wget to download"
    fi
    SRC="$TMP"
fi

# --- install ----------------------------------------------------------------
bash "$SRC/scripts/install.sh"

echo
echo "First install? Log out and back in once so GNOME Shell picks it up:"
echo "  gnome-session-quit --logout --no-prompt"
