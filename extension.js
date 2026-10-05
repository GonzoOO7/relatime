// relatime entry point.
//
// GJS caches ES modules by URL for the lifetime of the gnome-shell process,
// so this file is read from disk exactly once -- no matter how often the
// extension is disabled and re-enabled. Everything that we actually edit
// therefore lives in impl.js, which is read fresh on every enable().
//
// Reloading is just:  scripts/reload.sh  (disable + enable, no restart).
//
// The static imports below are safe: they are cached too, but they are
// immutable, so caching them costs us nothing. Note that the formatter in
// src/relatime.js is deliberately NOT imported here -- impl.js reads it from
// disk too, so it stays hot-reloadable as well.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// `this` is undefined at the top level of an ES module, so the Extension
// instance is not reachable here - derive our own directory from import.meta.
const DIR = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const IMPL_PATH = GLib.build_filenamev([DIR, 'impl.js']);

function readFile(path) {
    const [, bytes] = GLib.file_get_contents(path);
    if (!bytes)
        throw new Error(`relatime: cannot read ${path}`);
    return new TextDecoder().decode(bytes);
}

function loadImpl() {
    // impl.js is an expression evaluating to a factory, not a module, so that
    // it has no imports of its own and can be re-evaluated at will.
    return eval(`(${readFile(IMPL_PATH)})`);
}

// The eval happens per enable(), not at import time. Doing it at import time
// would bake the implementation into this cached module and defeat the point:
// the shell would then re-run enable() against the code that was on disk the
// first time it imported us, and edits would never be picked up.
export default class RelatimeExtension extends Extension {
    enable() {
        this._impl = loadImpl()({
            Clutter, GLib, GObject, St, Main, PanelMenu,
            uuid: this.uuid,
            dir: DIR,
        });

        try {
            this._impl.enable();
        } catch (e) {
            // Unwind whatever we managed to set up before rethrowing, so a
            // failure cannot leave a half-built clock behind.
            try {
                this._impl.disable();
            } catch {
                // best effort; the original error is the interesting one
            }
            this._impl = null;
            throw e;
        }
    }

    disable() {
        try {
            this._impl?.disable();
        } finally {
            this._impl = null;
        }
    }
}