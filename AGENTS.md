# relatime

GNOME Shell 50 panel clock extension showing time in relative-hour notation
(`08:50` renders as `9:-10`). Plain GJS/ESM, no build step.

## The development loop

```bash
npm test                      # 25 tests, incl. a real enable()/disable() run
gjs -m test/smoke.gjs.js      # pure core under GJS
gjs -m test/smoke-shim.gjs.js # real extension.js under GJS, end to end
./scripts/reload.sh           # install + disable/enable -> ~1s, no restart
```

Run all three test commands before `./scripts/reload.sh`. They catch almost
everything; the shell is the only thing that catches the rest.

## Do not touch

**`extension.js` is frozen. Treat it as if editing it were forbidden.**

GJS caches ES modules by URL for the lifetime of the `gnome-shell` process, so
that file is read from disk exactly once. An edit does nothing until the user
logs out and back in — which on Wayland is a real logout
(`gnome-session-quit --logout --no-prompt`), not a lock and not a reboot of
just the shell.

Everything that needs editing lives in `impl.js` instead, which is `eval`d on
every `enable()`.

### Never reload with a failing test

If `enable()` throws, the extension lands in `ExtensionState.ERROR`, and in
GNOME 50 that is a **one-way door**:

```js
_callExtensionEnable:        if (state !== INACTIVE) return;   // ERROR bails
_callExtensionDisableWithRebase: if (state !== ACTIVE) return;  // ERROR bails
```

Disable+enable on an errored extension is a permanent silent no-op. The only
recovery is a logout. `reload.sh` detects this and says so, but by then the
shell is already stuck.

### Do not change the UUID casually

The shell only enumerates extension directories at startup, so a new UUID also
costs a logout. `metadata.json`'s `uuid` is the single source of truth;
`scripts/install.sh` reads it.

## Where code goes

| file | hot-reloads | contents |
|---|---|---|
| `impl.js` | yes | all GNOME-facing code; `eval`d per `enable()` |
| `src/relatime.js` | yes | pure formatter; read from disk per `enable()` |
| `extension.js` | **no** | shim: immutable imports + the `eval` itself |

`impl.js` is **not** an ES module — it is an expression evaluating to a factory,
and it must stay that way so it can be re-evaluated. No `import` statements;
everything arrives as one argument (`Clutter`, `GLib`, `GObject`, `St`, `Main`,
`PanelMenu`, `uuid`, `dir`).

## Verified traps

Each of these cost a restart. Re-check against real bindings, not memory:

- **`Math.clamp()` does not exist** in gjs 1.88 — even though GNOME's own
  sources call it. Clamp by hand. There is a test guarding this.
- **`GLib.DateTime` has no `get_minutes()`**, only `get_minute()` (minute within
  the hour, 0–59). Seconds elapsed in the current minute is `get_seconds()`
  *alone*. Getting this wrong yields a negative timeout and a frozen clock.
- **`this` is `undefined` at ESM top level**, so the GNOME 40 `this.dir` pattern
  throws. Use `import.meta.url` — and note it resolves to *this* file, so take
  `path_get_dirname` before appending a sibling filename.
- A module that **threw during import is cached as failed** and never retried.
- Prefer running `enable()` under stubs in tests over reading the code. Nearly
  every bug in this project was a dropped step or a mis-shaped dependency
  argument that tests caught in a second.

## Useful references

The shell's own JavaScript is embedded in `/usr/lib/gnome-shell/libshell-18.so`
and can be read with `strings -n 5` — there is no `Shell-*.gir`, but the panel
and `PanelMenu.Button` implementations are all in there. There is also no
`.gir` for `Main.panel`, so types will not help you.
