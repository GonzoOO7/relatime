// End-to-end check of extension.js, the reload shim.
//
// extension.js cannot be imported outside gnome-shell (it pulls in
// resource:///org/gnome/shell/ui/main.js), so we rebuild it in a temp dir with
// the GNOME imports replaced by stubs and import the real file. Then we call
// enable()/disable() on it, exactly as the shell would.
//
//   gjs -m test/smoke-shim.gjs.js

import GLib from 'gi://GLib';

const THIS_FILE = GLib.filename_from_uri(import.meta.url)[0];
const ROOT = GLib.path_get_dirname(GLib.path_get_dirname(THIS_FILE));
const TMP = GLib.build_filenamev([GLib.get_tmp_dir(), 'relatime-shim-test']);

let failures = 0;
function check(ok, what) {
    print(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok)
        failures++;
}

function read(name) {
    const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([ROOT, name]));
    return new TextDecoder().decode(bytes);
}

function write(path, contents) {
    GLib.file_set_contents(path, contents);
}

const calls = [];
const record = (...args) => calls.push(args);

// --- stubs just functional enough to run enable()/disable() for real --------

class Actor {
    constructor(props = {}) {
        Object.assign(this, props);
        this.visible = true;
    }
    add_child() {}
    show() {}
    hide() {}
    destroy() { record('destroy'); }
    set_text() {}
    set_position() {}
    remove_all_transitions() {}
    ease() {}
    connect() { return 1; }
}

class StLabel extends Actor {
    constructor(props) {
        super(props);
    }
    set_text(t) { record('label', this.style_class, t); }
    set_style(...args) { record('set_style', ...args); }
    add_style_class_name(c) { record('add_class', c); this.style_class += ` ${c}`; }
    remove_style_class_name(c) { record('remove_class', c); }
}

class PanelButton extends Actor {
    constructor() {
        super();
        this._init?.();
    }
    _init() {}
}

const panel = {
    // The panel strip the overlay centres itself inside.
    height: 32,
    connect: () => record('panel.connect'),
    _updatePanel: () => record('_updatePanel'),
    addToStatusArea: (role, ind, pos, box) => {
        record('addToStatusArea', role, ind instanceof PanelButton, pos, box);
    },
    statusArea: {},
};

const stubs = `
const Clutter = {ActorAlign: {CENTER: 0}, AnimationMode: {EASE_OUT_QUAD: 0}};
const GLib = globalThis.__stubs.GLib;
const GObject = {registerClass: (meta, klass) => klass};
const St = {Label: globalThis.__stubs.StLabel, BoxLayout: globalThis.__stubs.StBoxLayout, Bin: globalThis.__stubs.StBin};
const Main = globalThis.__stubs.Main;
const PanelMenu = {Button: globalThis.__stubs.PanelButton};
const Extension = class {};
`;

const GLibOverrides = {
    timeout_add: (_p, _ms, _cb) => (record('timeout_add', _ms), 1),
    Source: {remove: () => record('source_remove')},
    PRIORITY_DEFAULT: 0,
    PRIORITY_DEFAULT_IDLE: -100,
    // Run it now: the overlay renders and positions itself from an idle
    // handler, and we want that path exercised rather than stubbed away.
    idle_add: (_p, cb) => { record('idle_add'); cb(); return 1; },
};
// The shim uses the real GLib for path resolution and file reads, so proxy
// through to it and intercept only the timer. GLib.DateTime is deliberately
// left real, so msToNextMinute() is checked against the actual bindings.
const stubGLib = new Proxy(GLib, {
    get: (target, prop) => (prop in GLibOverrides ? GLibOverrides[prop] : target[prop]),
});

const stage = {
    connect: () => (record('stage.connect'), 3),
    disconnect: () => record('stage.disconnect'),
};
// impl.js reads the ambient `global` (GNOME's), so provide it there.
globalThis.stage = stage;

globalThis.__stubs = {
    GLib: stubGLib,
    global: {stage},
    StLabel,
    StBoxLayout: class extends Actor {
        add_child(c) { record('box.add_child', c.style_class); }
    },
    StBin: class extends Actor {
        constructor(...args) { super(...args); this._init?.(...args); }
        _init() {}
        set_child(c) { record('set_child', c.style_class); }
        get_preferred_width() { return [90, 90]; }
        get_preferred_height() { return [24, 24]; }
        set_position(x, y) { record('set_position', x, y); }
    },
    PanelButton,
    Main: {
        panel,
        sessionMode: {panel: {left: [], center: ['dateMenu'], right: []}},
        layoutManager: {
            addChrome: () => record('addChrome'),
            addTopChrome: () => record('addTopChrome'),
            removeChrome: () => record('removeChrome'),
            connect: () => (record('lm.connect'), 7),
            disconnect: () => record('lm.disconnect'),
            primaryMonitor: {x: 0, y: 0, width: 1920, height: 1080},
        },
    },
};

// --- lay out a fake extension dir and import the real shim ------------------

GLib.mkdir_with_parents(`${TMP}/src`, 0o755);
write(`${TMP}/impl.js`, read('impl.js'));
write(`${TMP}/src/relatime.js`, read('src/relatime.js'));
write(`${TMP}/extension.js`, stubs + read('extension.js')
    .split('\n').filter(l => !l.startsWith('import ')).join('\n'));

const mod = await import(`file://${TMP}/extension.js`);
const ExtensionClass = mod.default;

// Guard against JS that gnome-shell's sources get away with but gjs 1.88
// (what actually runs our extension) does not have.
const implCode = read('impl.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
    .replace(/^\s*\/\/.*$/gm, '');            // line comments
check(!/Math\.clamp/.test(implCode),
    'impl.js code avoids Math.clamp (absent in gjs 1.88)');

check(typeof ExtensionClass === 'function', 'default export is a class');
check(typeof ExtensionClass?.prototype?.enable === 'function', 'has enable()');
check(typeof ExtensionClass?.prototype?.disable === 'function', 'has disable()');

// The instance stands in for the shell's Extension object.
const instance = new ExtensionClass();
instance.uuid = 'relatime@shim-test';

let enableThrew = null;
try {
    instance.enable();
} catch (e) {
    enableThrew = e;
}
check(!enableThrew, `enable() does not throw${enableThrew ? `: ${enableThrew}` : ''}`);

if (!enableThrew) {
    check(calls.some(c => c[0] === 'addToStatusArea' && c[1] === 'relatime@shim-test'),
        'enable() registered the button under our uuid');
    check(calls.some(c => c[0] === 'timeout_add'),
        'enable() armed the minute timer, so the clock keeps ticking');
    const labels = calls.filter(c => c[0] === 'label').map(c => c.slice(1));
    check(labels.length === 3,
        `three styled parts rendered (got ${JSON.stringify(labels)})`);
    check(!labels.some(([, t]) => String(t).includes('+')),
        `a plus sign is never drawn: ${JSON.stringify(labels)}`);
    // St.Widget.set_style takes ONE argument (a CSS declaration string); the
    // (property, value) form throws "Too many arguments" and applies nothing.
    const styleCall = calls.find(c => c[0] === 'set_style');
    check(styleCall && styleCall.length === 2 && /^background-color: #[0-9a-f]{6};$/.test(styleCall[1]),
        `minutes colour set as one CSS declaration (got ${JSON.stringify(styleCall)})`);
    check(labels.every(([, t]) => t !== undefined && !String(t).includes('undefined')),
        `no undefined in label text: ${JSON.stringify(labels)}`);
    check(labels.some(([cls]) => cls.endsWith('relatime-hour')),
        'hour part carries its own colour class');
    check(calls.some(c => c[0] === 'addChrome'),
        'tooltip added via addChrome so it draws above the panel');
    check(globalThis.__stubs.Main.sessionMode.panel.center.length === 0,
        "enable() removed the 'dateMenu' role");

    instance.disable();
    check(calls.some(c => c[0] === 'source_remove'), 'disable() stopped the timer');
    check(globalThis.__stubs.Main.sessionMode.panel.center.join() === 'dateMenu',
        "disable() put 'dateMenu' back");

    // A second cycle must behave identically - that is the whole point of the shim.
    calls.length = 0;
    instance.enable();
    instance.disable();
    check(globalThis.__stubs.Main.sessionMode.panel.center.join() === 'dateMenu',
        'a second enable/disable cycle is still consistent');
}

if (failures) {
    print(`\n${failures} check(s) failed`);
    imports.system.exit(1);
}
print('\nshim smoke test passed');