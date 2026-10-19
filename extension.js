// Frozen shim: GJS caches ES modules by URL for the shell's lifetime, so this
// file is read once. Everything editable lives in impl.js, re-eval'd per enable().

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// `this` is undefined at ESM top level; derive dir from import.meta.
const DIR = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const IMPL_PATH = GLib.build_filenamev([DIR, 'impl.js']);

function readFile(path) {
    const [, bytes] = GLib.file_get_contents(path);
    if (!bytes)
        throw new Error(`relatime: cannot read ${path}`);
    return new TextDecoder().decode(bytes);
}

// Eval per enable(), not at import time, so edits are picked up.
function loadImpl() {
    return eval(`(${readFile(IMPL_PATH)})`);
}

export default class RelatimeExtension extends Extension {
    enable() {
        this._impl = loadImpl()({
            Clutter, GLib, GObject, St, Main, PanelMenu,
            uuid: this.uuid, dir: DIR,
        });
        try {
            this._impl.enable();
        } catch (e) {
            try { this._impl.disable(); } catch {}
            this._impl = null;
            throw e;
        }
    }
    disable() {
        try { this._impl?.disable(); } finally { this._impl = null; }
    }
}
