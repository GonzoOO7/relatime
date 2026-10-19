import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';

// this file lives in test/, the project root is one level up
const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const source = readFileSync(`${ROOT}/impl.js`, 'utf8');

// impl.js is an expression, not a module: exactly how extension.js loads it.
const factory = eval(`(${source})`);
const {offsetColor} = await import('../src/relatime.js');

/**
 * Stubs that are just functional enough to actually run enable()/disable().
 * These exist to catch wiring bugs - a dep that is not passed, a step dropped
 * in a refactor - which no amount of staring at the code finds.
 *
 * Note: this fakes GLib's file/path helpers, so it cannot catch mistakes in
 * real bindings. That is what test/smoke-shim.gjs.js is for: it runs the same
 * code under gjs against the real GLib, St and DateTime.
 */
function stubDeps() {
    const calls = [];
    const registered = [];
    const record = (...args) => calls.push(args);

    const stage = {
        connect: () => (record('stage.connect'), 3),
        disconnect: () => record('stage.disconnect'),
    };
    // impl.js uses GNOME's ambient `global`, not a dep, so stand in for it.
    globalThis.stage = stage;

    class Actor {
        constructor(props = {}) {
            Object.assign(this, props);
            this.visible = true;
        }
        add_child() {}
        show() {}
        hide() {}
        destroy() { record('destroy', this.constructor.name); }
        set_text() {}
        set_position() {}
        remove_all_transitions() {}
        ease() {}
        connect() { return 1; }
    }

    class StLabel extends Actor {
        constructor(...args) {
            super(...args);
            // GObject subclasses get _init() called by the constructor, with the
            // constructor's own arguments forwarded.
            this._init?.(...args);
        }
        _init() {}
        set_text(t) { record('label', this.style_class, t); }
        set_style(...args) { record('set_style', ...args); }
        add_style_class_name(c) { record('add_class', c); this.style_class += ` ${c}`; }
        remove_style_class_name(c) { record('remove_class', c); }
    }

    // GObject subclasses get _init() called by the constructor; mirror that.
    class PanelButton extends Actor {
        constructor() {
            super();
            this._init?.();
        }
        _init() {}
    }

    let button = null;

    const panel = {
        // The panel strip the overlay centres itself in.
        height: 32,
        connect: () => record('panel.connect'),
        _updatePanel: () => record('_updatePanel'),
        addToStatusArea: (role, ind, pos, box) => {
            button = ind;
            record('addToStatusArea', role, pos, box);
        },
        // No dateMenu present -> the role patch counts as successful.
        statusArea: {},
    };

    const deps = {
        Clutter: {ActorAlign: {CENTER: 0}, AnimationMode: {EASE_OUT_QUAD: 0}},
        GLib: {
            build_filenamev: parts => parts.join('/'),
            path_get_dirname: p => p.slice(0, p.lastIndexOf('/')),
            file_get_contents: p => [true, readFileSync(p)],
            timeout_add: (_p, ms, _cb) => (record('timeout_add', ms), 1),
            // Run the callback now: the overlay positions itself from an
            // idle handler, and we want that path covered.
            idle_add: (_p, cb) => { record('idle_add'); cb(); return 1; },
            PRIORITY_DEFAULT_IDLE: -100,
            SOURCE_REMOVE: false,
            Source: {remove: () => record('source_remove')},
            PRIORITY_DEFAULT: 0,
            DateTime: {new_now_local: () => ({get_seconds: () => 30, get_minute: () => 10, format: () => '00:10'})},
        },
        GObject: {
            registerClass: (meta, klass) => (registered.push(meta.GTypeName), klass),
        },
        St: {
            Label: StLabel,
            BoxLayout: class extends Actor {
                add_child(c) { record('box.add_child', c.style_class); }
            },
            // St.Bin: what the overlay extends.
            Bin: class extends Actor {
                constructor(...args) { super(...args); this._init?.(...args); }
                _init() {}
                set_child(c) { record('set_child', c.style_class); }
                get_preferred_width() { return [90, 90]; }
                get_preferred_height() { return [24, 24]; }
                set_position(x, y) { record('set_position', x, y); }
            },
        },
        Main: {
            panel,
            sessionMode: {panel: {left: [], center: ['dateMenu'], right: []}},
            layoutManager: {
                addChrome: () => record('addChrome'),
                addTopChrome: () => record('addTopChrome'),
                addTopChrome: () => record('addTopChrome'),
                removeChrome: () => record('removeChrome'),
                connect: () => (record('lm.connect'), 7),
                disconnect: () => record('lm.disconnect'),
                primaryMonitor: {x: 0, y: 0, width: 1920, height: 1080},
            },
        },
        PanelMenu: {Button: PanelButton},
        uuid: 'relatime@test',
        dir: ROOT,
    };

    return {deps, calls, registered, panel, button: () => button};
}

test('impl.js is an expression that evaluates to a factory', () => {
    assert.equal(typeof factory, 'function');
    assert.equal(factory.length, 1);
});

test('the factory yields an object with enable/disable', () => {
    const impl = factory(stubDeps().deps);
    assert.equal(typeof impl, 'object');
    assert.equal(typeof impl.enable, 'function');
    assert.equal(typeof impl.disable, 'function');
});

test('the factory loads the formatter from disk, not from deps', () => {
    // deps deliberately carries no formatters; if impl.js depended on them
    // instead of reading src/relatime.js, this would throw.
    const {deps} = stubDeps();
    assert.equal(deps.formatMarkup, undefined);
    assert.doesNotThrow(() => factory(deps));
});

test('the factory is callable repeatedly (it runs on every enable)', () => {
    const {deps} = stubDeps();
    assert.notEqual(factory(deps), factory(deps));
});

test('reloading registers fresh GType names (GTypes may not be reused)', () => {
    const first = stubDeps();
    const second = stubDeps();
    factory(first.deps);
    factory(second.deps);

    assert.equal(first.registered.length, 2, 'tooltip and overlay classes per load');
    const names = [...first.registered, ...second.registered];
    assert.equal(new Set(names).size, names.length, `GType names must be unique: ${names}`);
});

test('enable() puts the clock in the panel centre and starts the minute timer', () => {
    const {deps, calls} = stubDeps();
    factory(deps).enable();

    assert.deepEqual(calls.find(c => c[0] === 'addToStatusArea'),
        ['addToStatusArea', deps.uuid, 0, 'center']);
    // RelatimeButton has its own armTick(); the observable effect is the
    // timeout it registers. At :30 seconds we want ~30.5s until the boundary.
    const timer = calls.find(c => c[0] === 'timeout_add');
    assert.ok(timer, 'the minute timer must be armed, or the clock freezes');
    assert.ok(timer[1] > 30000 && timer[1] < 31000,
        `unexpected delay ${timer[1]}ms - must be positive and near the boundary`);
});

test('enable() removes the dateMenu role and rebuilds the panel', () => {
    const {deps, calls} = stubDeps();
    factory(deps).enable();

    assert.deepEqual(deps.Main.sessionMode.panel.center, [],
        "the stock clock's role is gone");
    assert.ok(calls.some(c => c[0] === '_updatePanel'),
        'and the panel is rebuilt so the change takes effect');
});

test('disable() puts the dateMenu role back where it was', () => {
    const {deps} = stubDeps();
    const impl = factory(deps);

    impl.enable();
    assert.deepEqual(deps.Main.sessionMode.panel.center, []);

    impl.disable();
    assert.deepEqual(deps.Main.sessionMode.panel.center, ['dateMenu']);
});

test('enable() renders hour, colon, coarse and exact parts', () => {
    const {deps, calls} = stubDeps();
    factory(deps).enable();

    const labels = calls.filter(c => c[0] === 'label').map(c => c.slice(1));
    assert.equal(labels.length, 4, `expected 4 parts, got ${JSON.stringify(labels)}`);
    assert.ok(labels.some(([cls]) => cls.endsWith('relatime-exact')),
        'the exact figure has its own part');
    for (const [cls, text] of labels)
        assert.ok(cls.includes('relatime-') && text !== undefined && !String(text).includes('undefined'),
            `label ${cls} has bad text ${text}`);

    const byClass = Object.fromEntries(labels);
    assert.match(byClass['relatime-part relatime-hour'], /^\d+$/, 'hour is a bare number');
    assert.equal(byClass['relatime-part relatime-colon'], ':');

    const minutesText = String(labels.find(([c]) => c.includes('relatime-minutes'))?.[1]);
    assert.match(minutesText, /^-?\d{1,2}$/, `minutes are their own part: ${minutesText}`);
    assert.ok(!/^-?0\d/.test(minutesText), `no leading zero on the chip: ${minutesText}`);

    // A minus may be drawn for negatives; a plus never is.
    assert.equal(labels.filter(([, t]) => String(t).includes('+')).length, 0,
        `a plus sign must never be rendered: ${JSON.stringify(labels)}`);
});


test('enable() renders hour, colon, coarse and exact parts', () => {
    const {deps, calls} = stubDeps();
    factory(deps).enable();

    const labels = calls.filter(c => c[0] === 'label').map(c => c.slice(1));
    assert.equal(labels.length, 4, `expected 4 parts, got ${JSON.stringify(labels)}`);
    assert.ok(labels.some(([cls]) => cls.endsWith('relatime-exact')),
        'the exact figure has its own part');
    for (const [cls, text] of labels)
        assert.ok(cls.includes('relatime-') && text !== undefined && !String(text).includes('undefined'),
            `label ${cls} has bad text ${text}`);

    const byClass = Object.fromEntries(labels);
    assert.match(byClass['relatime-part relatime-hour'], /^\d+$/, 'hour is a bare number');
    assert.equal(byClass['relatime-part relatime-colon'], ':');

    const minutesText = String(labels.find(([c]) => c.includes('relatime-minutes'))?.[1]);
    assert.match(minutesText, /^-?\d{1,2}$/, `minutes are their own part: ${minutesText}`);
    assert.ok(!/^-?0\d/.test(minutesText), `no leading zero on the chip: ${minutesText}`);

    // A minus may be drawn for negatives; a plus never is.
    assert.equal(labels.filter(([, t]) => String(t).includes('+')).length, 0,
        `a plus sign must never be rendered: ${JSON.stringify(labels)}`);
});

test('enable() puts the tooltip above the panel with addChrome', () => {
    const {deps, calls} = stubDeps();
    factory(deps).enable();
    assert.ok(calls.some(c => c[0] === 'addChrome'));
    assert.equal(calls.filter(c => c[0] === 'addTopChrome').length, 0,
        'no top chrome: nothing here is meant to survive fullscreen');
});





test('disable() tears down the overlay and the tooltip', () => {
    const {deps, calls} = stubDeps();
    const impl = factory(deps);

    impl.enable();
    impl.disable();

    assert.ok(calls.some(c => c[0] === 'source_remove'), 'timer must be stopped');
    assert.ok(calls.some(c => c[0] === 'removeChrome'), 'tooltip must leave the chrome');
    assert.ok(calls.filter(c => c[0] === 'destroy').length >= 2,
        'both the button and the tooltip must be destroyed');
});

test('enable/disable/enable leaves the panel exactly as it started', () => {
    const {deps} = stubDeps();
    const impl = factory(deps);

    impl.enable();
    impl.disable();
    impl.enable();
    impl.disable();

    assert.deepEqual(deps.Main.sessionMode.panel.center, ['dateMenu'],
        "the stock clock must come back, once, at its original index");
});
test('the hour turns blue at night and yellow again in the morning', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();

    const mods = () => calls.filter(c => c[0] === 'add_class' || c[0] === 'remove_class');
    const at = (h, m = 10) => { calls.length = 0; label.refresh(new Date(2024, 0, 1, h, m)); };
    const addedNight = () => mods().some(c => c[0] === 'add_class' && c[1] === 'relatime-night');
    const droppedNight = () => mods().some(c => c[0] === 'remove_class' && c[1] === 'relatime-night');

    at(21);  assert.equal(addedNight(), false, '21:10 is still day');
    at(21, 35); assert.ok(addedNight(), '21:35 reads 10:-25, base hour 22 -> blue');
    at(21, 29); assert.ok(droppedNight(), '21:29 reads 9:-29, base hour 21 -> yellow again');
    at(22);  assert.ok(addedNight(), '22:00 turns the hour blue');
    at(23);  assert.equal(mods().length, 0, '23:10 stays blue, no churn');
    at(0);   assert.equal(mods().length, 0, '00:10 is still blue, no churn');
    at(4);   assert.equal(mods().length, 0, '04:10 is still blue, no churn');
    at(5);   assert.ok(droppedNight(), '05:00 turns the hour yellow again');
    at(12);  assert.equal(mods().length, 0, '12:10 is yellow, no churn');
    at(22);  assert.ok(addedNight(), 'blue again the same evening');
    at(5);   assert.ok(droppedNight(), 'and yellow again next morning');
});

test('repeated refreshes at the same time do not churn style classes', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();
    const day = new Date(2024, 0, 1, 12, 10);

    // Warm up: enable() refreshed with the real current time, whose sign may
    // differ from `day`, and that first change is legitimate.
    label.refresh(day);
    calls.length = 0;
    for (let i = 0; i < 5; i++)
        label.refresh(day);
    // The minutes colour is re-applied each tick (it is inline CSS, not a
    // class), but no *class* may churn - that would restyle the widget for
    // no reason.
    assert.equal(calls.filter(c => c[0] === 'add_class' || c[0] === 'remove_class').length, 0,
        'idle minutes must not re-trigger a class change');
});

test('the minutes colour comes from the banded ramp, not the sign', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();

    const colour = () => {
        const s = calls.filter(c => c[0] === 'set_style').at(-1);
        if (!s)
            return null;
        // Exactly one argument, a CSS declaration string. St throws
        // "Too many arguments" for the (property, value) form and then
        // applies nothing at all, leaving the minutes white.
        assert.equal(s.length, 2, `set_style must get 1 arg, got ${s.length - 1}`);
        const m = /^background-color: (#[0-9a-f]{6});$/.exec(s[1]);
        return m ? m[1] : null;
    };

    calls.length = 0; label.refresh(new Date(2024, 0, 1, 12, 30));
    assert.equal(colour(), offsetColor(-30), 'half past is full red');

    calls.length = 0; label.refresh(new Date(2024, 0, 1, 12, 45));
    assert.equal(colour(), offsetColor(-15), 'quarter to is mid red');

    calls.length = 0; label.refresh(new Date(2024, 0, 1, 12, 0));
    assert.equal(colour(), offsetColor(0), 'on the hour is white');

    calls.length = 0; label.refresh(new Date(2024, 0, 1, 12, 20));
    assert.equal(colour(), offsetColor(+20), 'past is green-ish');
});

test('the coarse figure is always a multiple of five', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();

    const coarse = m => {
        calls.length = 0;
        label.refresh(new Date(2024, 0, 1, 12, m));
        return String(calls
            .find(c => c[0] === 'label' && c[1].includes('relatime-part relatime-minutes'))?.[2]);
    };

    for (let m = 0; m < 60; m++) {
        const shown = coarse(m);
        const digits = shown.replace('-', '');
        assert.ok(Number(digits) % 5 === 0, `minute ${m}: "${shown}" is not a multiple of 5`);
        assert.doesNotMatch(shown, /^-?0\d/, `leading zero: ${shown}`);
        assert.ok(!shown.startsWith('+'), `a plus sign must never be drawn: ${shown}`);
    }
});

test('the exact figure carries the true offset, and is always shown', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();

    const exactAt = (m) => {
        calls.length = 0;
        label.refresh(new Date(2024, 0, 1, 12, m));
        const call = calls.find(c => c[0] === 'label' && c[1].includes('relatime-exact'));
        return call ? String(call[2]) : null;
    };

    // 12:26 is 26 past the hour: coarse 25, exact 26.
    assert.equal(exactAt(26), '26');
    // 12:25 lands on a multiple of five, but the exact figure is shown anyway.
    assert.equal(exactAt(25), '25');
    // 12:54 counts back to the next hour, so it is -6 and keeps its minus.
    assert.equal(exactAt(54), '-6');
});





test('disable() tears down the overlay and the tooltip', () => {
    const {deps, calls} = stubDeps();
    const impl = factory(deps);

    impl.enable();
    impl.disable();

    assert.ok(calls.some(c => c[0] === 'source_remove'), 'timer must be stopped');
    assert.ok(calls.some(c => c[0] === 'removeChrome'), 'tooltip must leave the chrome');
    assert.ok(calls.filter(c => c[0] === 'destroy').length >= 2,
        'both the button and the tooltip must be destroyed');
});

test('enable/disable/enable leaves the panel exactly as it started', () => {
    const {deps} = stubDeps();
    const impl = factory(deps);

    impl.enable();
    impl.disable();
    impl.enable();
    impl.disable();

    assert.deepEqual(deps.Main.sessionMode.panel.center, ['dateMenu'],
        "the stock clock must come back, once, at its original index");
});
test('the hour turns blue at night and yellow again in the morning', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();

    const mods = () => calls.filter(c => c[0] === 'add_class' || c[0] === 'remove_class');
    const at = (h, m = 10) => { calls.length = 0; label.refresh(new Date(2024, 0, 1, h, m)); };
    const addedNight = () => mods().some(c => c[0] === 'add_class' && c[1] === 'relatime-night');
    const droppedNight = () => mods().some(c => c[0] === 'remove_class' && c[1] === 'relatime-night');

    at(21);  assert.equal(addedNight(), false, '21:10 is still day');
    at(21, 35); assert.ok(addedNight(), '21:35 reads 10:-25, base hour 22 -> blue');
    at(21, 29); assert.ok(droppedNight(), '21:29 reads 9:-29, base hour 21 -> yellow again');
    at(22);  assert.ok(addedNight(), '22:00 turns the hour blue');
    at(23);  assert.equal(mods().length, 0, '23:10 stays blue, no churn');
    at(0);   assert.equal(mods().length, 0, '00:10 is still blue, no churn');
    at(4);   assert.equal(mods().length, 0, '04:10 is still blue, no churn');
    at(5);   assert.ok(droppedNight(), '05:00 turns the hour yellow again');
    at(12);  assert.equal(mods().length, 0, '12:10 is yellow, no churn');
    at(22);  assert.ok(addedNight(), 'blue again the same evening');
    at(5);   assert.ok(droppedNight(), 'and yellow again next morning');
});

test('repeated refreshes at the same time do not churn style classes', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();
    const day = new Date(2024, 0, 1, 12, 10);

    // Warm up: enable() refreshed with the real current time, whose sign may
    // differ from `day`, and that first change is legitimate.
    label.refresh(day);
    calls.length = 0;
    for (let i = 0; i < 5; i++)
        label.refresh(day);
    // The minutes colour is re-applied each tick (it is inline CSS, not a
    // class), but no *class* may churn - that would restyle the widget for
    // no reason.
    assert.equal(calls.filter(c => c[0] === 'add_class' || c[0] === 'remove_class').length, 0,
        'idle minutes must not re-trigger a class change');
});

test('the minutes colour comes from the banded ramp, not the sign', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();

    const colour = () => {
        const s = calls.filter(c => c[0] === 'set_style').at(-1);
        if (!s)
            return null;
        // Exactly one argument, a CSS declaration string. St throws
        // "Too many arguments" for the (property, value) form and then
        // applies nothing at all, leaving the minutes white.
        assert.equal(s.length, 2, `set_style must get 1 arg, got ${s.length - 1}`);
        const m = /^background-color: (#[0-9a-f]{6});$/.exec(s[1]);
        return m ? m[1] : null;
    };

    calls.length = 0; label.refresh(new Date(2024, 0, 1, 12, 30));
    assert.equal(colour(), offsetColor(-30), 'half past is full red');

    calls.length = 0; label.refresh(new Date(2024, 0, 1, 12, 45));
    assert.equal(colour(), offsetColor(-15), 'quarter to is mid red');

    calls.length = 0; label.refresh(new Date(2024, 0, 1, 12, 0));
    assert.equal(colour(), offsetColor(0), 'on the hour is white');

    calls.length = 0; label.refresh(new Date(2024, 0, 1, 12, 20));
    assert.equal(colour(), offsetColor(+20), 'past is green-ish');
});

test('the coarse figure is always a multiple of five', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();

    const coarse = m => {
        calls.length = 0;
        label.refresh(new Date(2024, 0, 1, 12, m));
        return String(calls
            .find(c => c[0] === 'label' && c[1].includes('relatime-part relatime-minutes'))?.[2]);
    };

    for (let m = 0; m < 60; m++) {
        const shown = coarse(m);
        const digits = shown.replace('-', '');
        assert.ok(Number(digits) % 5 === 0, `minute ${m}: "${shown}" is not a multiple of 5`);
        assert.doesNotMatch(shown, /^-?0\d/, `leading zero: ${shown}`);
        assert.ok(!shown.startsWith('+'), `a plus sign must never be drawn: ${shown}`);
    }
});

test('the exact figure carries the true offset, and is always shown', () => {
    const {deps, calls, button} = stubDeps();
    factory(deps).enable();
    const label = button();

    const exactAt = (m) => {
        calls.length = 0;
        label.refresh(new Date(2024, 0, 1, 12, m));
        const call = calls.find(c => c[0] === 'label' && c[1].includes('relatime-exact'));
        return call ? String(call[2]) : null;
    };

    // 12:26 is 26 past the hour: coarse 25, exact 26.
    assert.equal(exactAt(26), '26');
    // 12:25 lands on a multiple of five, but the exact figure is shown anyway.
    assert.equal(exactAt(25), '25');
    // 12:54 counts back to the next hour, so it is -6 and keeps its minus.
    assert.equal(exactAt(54), '-6');
});


