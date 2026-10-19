# relatime — reference notes

Everything here was verified against real bindings, not recalled. Where a fact came
from a surprising place, that is noted — several contradict what older
GNOME extension tutorials say.

## Environment

| | |
|---|---|
| GNOME Shell | 50.5, Wayland session |
| gjs | 1.88.1 (`gjs -m` for modules, `gjs -m file.js` to run) |
| Node | 24.21.0 — `node --test` built in, no dependencies needed |
| user extensions | `~/.local/share/gnome-shell/extensions/<uuid>/` |
| settings | `org.gnome.shell enabled-extensions` / `disabled-extensions` |

## Reading the shell's own source

There is **no `Shell-*.gir`** on this system, so types will not help you. But
the shell's JavaScript is embedded in a library and can be read as text:

```bash
strings -n 5 /usr/lib/gnome-shell/libshell-18.so > /tmp/sh.txt
grep -n "get panel()" /tmp/sh.txt
```

This is how every panel fact below was confirmed. It is much faster than
guessing, and it settled several long-standing assumptions immediately.

`gresource list` does **not** work on that library (`invalid gvdb header`), and
the JS is not shipped as loose files in the package.

## GNOME 50 panel internals

| fact | detail |
|---|---|
| the clock is not `Main.panel.dateMenu` | it is `Main.panel.statusArea.dateMenu`, a `DateMenuButton` |
| indicators are wrapped | the actor actually inserted into the box is `indicator.container`, not the button. `ButtonBox` builds `container = new St.Bin({child: this})` |
| the panel is declarative | `Main.sessionMode.panel` is `{left, center, right}` arrays of **role names**. The user session has `center: ['dateMenu']`. `Panel._updatePanel()` rebuilds all three boxes from them |
| `_updatePanel()` hides first | `_hideIndicators()` hides every indicator's container, then `_updateBox()` re-shows the ones in the role lists. Anything not listed stays hidden |
| role → class table | `PANEL_ITEM_IMPLEMENTATIONS` maps `dateMenu`, `activities`, `quickSettings`, `a11y`, `keyboard`, … |
| `addToStatusArea` still works | throws on role conflict and on a non-`PanelMenu.Button`; otherwise inserts `indicator.container` |
| `Main.messageTray.bannerAlignment` | derived from whether `dateMenu` is in the panel list; falls back to `CENTER` |

### Hiding the stock clock

Two mechanisms, and we apply **both** because the log showed the role patch
succeeding and failing unpredictably:

1. splice `'dateMenu'` out of `Main.sessionMode.panel.{left,center,right}`,
   then `Main.panel._updatePanel()`;
2. `statusArea.dateMenu.container.hide()`, plus re-hide on
   `Main.sessionMode` `'updated'` (the panel rebuilds on mode changes).

Restore reverses both, re-inserting `'dateMenu'` at its original index.

## St widgets

| fact | detail |
|---|---|
| tooltips are **gone** | no `tooltip-text` property in `libst-18.so`, and `set_tooltip_text` is not a function. The only `Tooltip` class in the shell is private to `ui/screenshot.js` |
| `style_class` is construct-only | assigning `label.style_class = '…'` at runtime does nothing. Use `add_style_class_name()` / `remove_style_class_name()` |
| `ease()` exists | takes `{opacity, duration, mode, onComplete}` |
| Pango markup is unreliable here | `set_markup()` with `<span foreground="#3584e4">` visibly failed to colour one span while colouring its neighbour. We use one `St.Label` per coloured part and CSS `color:` instead — easier to reason about and to override |
| CSS specificity | `.relatime-hour.relatime-night` (0,2,0) correctly beats `.relatime-hour` (0,1,0) |
| above the panel | `Main.layoutManager.addChrome(actor, {trackFullscreen: false})`, paired with `removeChrome`. `Main.uiGroup` is `set_no_layout(true)`, so `set_position()` is authoritative |

### addChrome vs addTopChrome — and why fullscreen wins

```js
addChrome(actor, params) {
    this.uiGroup.add_child(actor);
    if (this.uiGroup.contains(global.top_window_group))
        this.uiGroup.set_child_below_sibling(actor, global.top_window_group);
    ...
}
```

The shell's own comment says it outright:

> Using addChrome() to add actors to uiGroup will position actors **underneath the
> top_window_group**. To insert actors at the top of uiGroup, we use addTopChrome().

Fullscreen windows are parented into `global.top_window_group`, so **anything added
with `addChrome()` is covered by every fullscreen window.** That cost us a long
detour: an always-visible clock added via `addChrome()` was hidden by F11, and the
tooltip's attachment and `reactive` flag were both blamed before the stacking order
was checked. `addTopChrome(actor, params)` omits the `set_child_below_sibling` call
and is the correct entry point for anything that must survive fullscreen.

### `set_style` takes ONE argument

```js
label.set_style('color: #dd766c;');            // ✅ CSS declaration string
label.set_style('color', '#dd766c');           // ❌ "Too many arguments to method
                                                //     St.Widget.set_style: expected 1, got 2"
```

The two-argument form throws **and applies nothing at all** — no exception
reaches the extension, the label just silently keeps its default colour. This
burned an hour: the code was correct, the computed hex was correct, and the
clock was still white.

This is the one class of bug our tests could not catch: the GJS smoke test
*stubs* `St`, so it never sees the real method signature. **GI method arity is
only verifiable in the live shell** — put a `console.log` next to the call and
read the journal.

## gjs 1.88 language gaps

```js
gjs -m /tmp/c.js   # print(typeof Math.clamp)
# undefined
```

`Math.clamp()` **does not exist**, even though GNOME's own sources call it.
`??=`, `?.`, top-level `await`, `import.meta.url` and `globalThis` all work.

There is a test guarding this (`test/smoke-shim.gjs.js`), because the trap is
that GNOME's source is right and our runtime is not.

## GLib.DateTime

```js
const now = GLib.DateTime.new_now_local();
now.get_seconds()   // seconds within the minute
now.get_minute()    // minute within the hour, 0-59
now.get_minutes     // undefined — does not exist in the bindings
```

Seconds elapsed in the current minute is `get_seconds()` **alone**. Adding
`get_minute() * 60` yields ~2700 s and therefore a large **negative** timeout.

## GJS module caching

The rule that governs this project's architecture:

- **ES modules are cached by URL for the lifetime of the `gnome-shell`
  process.** An extension's `extension.js` is read from disk exactly once.
- **A module that threw during import is cached as failed** and is never
  retried. Disable+enable keeps reporting the original error even with the fix
  on disk.
- `import('./x.js?v=' + Date.now())` does **not** bust the cache — the query
  string is ignored (verified in plain `gjs`).
- `eval()` bypasses the cache completely: fresh parse, fresh object, every
  time (verified).
- The only way to get a *different* module URL is a different UUID — which
  means a different directory — and the shell only enumerates extension
  directories **at startup**, so even that needs a restart.

That is the entire reason `extension.js` is a frozen shim and everything else
is re-read per `enable()`.

## The extension state machine

```
INITIALIZED → INACTIVE → ACTIVATING → ACTIVE → DEACTIVATING → INACTIVE
                    ↘ ERROR (terminal until the shell restarts)
```

```js
async _callExtensionEnable(uuid) {
    if (extension.state !== ExtensionState.INACTIVE) return;  // ERROR bails
}
async _callExtensionDisableWithRebase(uuid) {
    if (extension.state !== ExtensionState.ACTIVE) return;    // ERROR bails
}
```

**`ERROR` is a one-way door.** Enable bails because it is not `INACTIVE`;
disable bails because it is not `ACTIVE`. Disable+enable on a broken extension
is a permanent silent no-op, and the only recovery is a logout.

Also: `enableExtension()`/`disableExtension()` only flip the gsettings key. The
real work happens in the `changed::enabled-extensions` handler, so a fast
disable+enable can coalesce into no net change at all.

GObject GType names are process-global and may only be registered once, so
reloading registers new names from a counter kept on `globalThis` (one GType
leaks per reload — harmless).

## D-Bus: what works

| call | result |
|---|---|
| `org.gnome.Shell.Extensions.GetExtensionErrors <uuid>` | ✅ **the only reliable error channel here** — this setup journals nothing |
| `org.gnome.Shell.Extensions.EnableExtension` / `DisableExtension` | ✅ but see the coalescing note above |
| `org.gnome.Shell.Eval` | ⚠️ returns `(false, '')` unless `global.context.unsafe_mode` is true; only switchable from Looking Glass (`Alt+F2` → `lg`) |
| `org.gnome.Shell.Extensions.ReloadExtension` | ❌ declared in the XML, answers `NOT_SUPPORTED, 'ReloadExtension is deprecated and does not work'` |
| `gnome-session-quit --logout --no-prompt` | ✅ real logout; `SessionManager.Logout(1)` via `gdbus` only reached the lock screen without restarting the shell |
| `gnome-shell --replace` | untested on Wayland; not needed |
| `gnome-shell --nested` | gone from `--help` on 50; `--virtual-monitor` survives |

This setup does **not** journal extension errors to the user journal, which
is why `scripts/status.sh` prefers D-Bus and scopes the journal read to the
current shell's start time.

## Debugging techniques that earned their keep

1. **Corruption test.** Append garbage to `impl.js`, reload, and check the
   extension notices. Passing silently means the code is not being re-read.
2. **Marker file.** Have the factory write `/tmp/marker` with `Date.now()`.
   If the file appears on reload, the reload really re-executed the source.
   This is what finally proved the reload loop worked.
3. **Run `enable()` in tests.** Every one of the dropped-step and wrong-shape
   bugs was found by executing the code under stubs, not by reading it.
4. **Use real bindings where possible.** The Node stub had `get_minutes()` —
   the same wrong name as the code — so tests passed against a fiction. The
   GJS smoke test now uses the real `GLib.DateTime` and only intercepts the
   timer.

## Project layout

| file | role | hot-reloads |
|---|---|---|
| `extension.js` | frozen entry point: immutable static imports + the `eval` | ❌ |
| `impl.js` | all GNOME-facing code; an expression, not a module | ✅ |
| `src/relatime.js` | pure formatter, no GI imports | ✅ (read from disk by `impl.js`) |
| `test/*.test.js` | Node, `node --test` | — |
| `test/smoke*.gjs.js` | under GJS; the shim one uses real GLib | — |
| `scripts/install.sh` | rsync + queue enable, uuid from `metadata.json` | — |
| `scripts/reload.sh` | install + disable/enable; the whole inner loop | — |
| `scripts/status.sh` | D-Bus state and errors, current-session log | — |