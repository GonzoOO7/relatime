# relatime

GNOME Shell 50 panel clock extension showing time in relative-hour notation
(`08:50` renders as `9:-10`). Plain GJS/ESM, no build step.

## The development loop

```bash
npm test                      # unit tests, incl. a real enable()/disable() run
gjs -m test/smoke.gjs.js      # pure core under GJS
gjs -m test/smoke-shim.gjs.js # real extension.js under GJS, end to end
./scripts/reload.sh           # install + disable/enable -> ~1s, no restart
./scripts/status.sh           # D-Bus state + errors
```

Run the three tests before `reload.sh`; they catch almost everything, the shell
catches the rest. After every change, reload and check `status.sh` says `ACTIVE`,
no errors. Never with a failing test.

## Do not touch

**`extension.js` is frozen. Treat it as if editing it were forbidden.** GJS
caches ES modules by URL for the lifetime of the `gnome-shell` process, so that
file is read once at startup; an edit does nothing until a real logout
(`gnome-session-quit --logout --no-prompt` on Wayland). Everything editable lives
in `impl.js`, which is `eval`d on every `enable()`.

**Never reload with a failing test.** If `enable()` throws, the extension lands
in `ExtensionState.ERROR`, and in GNOME 50 that is a one-way door: the shell's
`_callExtensionEnable` and `_callExtensionDisableWithRebase` both bail unless the
state is exactly what they expect, so disable+enable on an errored extension is a
permanent silent no-op. The only recovery is a logout. `reload.sh` says so, but
by then the shell is already stuck.

**Do not change the UUID casually** — the shell only enumerates extension
directories at startup, so a new UUID costs a logout too. `metadata.json`'s
`uuid` is the single source of truth; `scripts/install.sh` reads it.

## Where code goes

| file | hot-reloads | contents |
|---|---|---|
| `impl.js` | yes | all GNOME-facing code; `eval`d per `enable()` |
| `src/relatime.js` | yes | pure formatter; read from disk per `enable()` |
| `extension.js` | **no** | shim: immutable imports + the `eval` itself |

`impl.js` is **not** an ES module — it is an expression evaluating to a factory,
and must stay that way so it can be re-evaluated. No `import` statements;
everything arrives as one argument (`Clutter`, `GLib`, `GObject`, `St`, `Main`,
`PanelMenu`, `uuid`, `dir`).

## Verified traps

Each of these cost a restart. Re-check against real bindings, not memory:

- **`Math.clamp()` does not exist** in gjs 1.88, even though GNOME's own sources
  call it. Clamp by hand. There is a test guarding this.
- **`GLib.DateTime` has no `get_minutes()`**, only `get_minute()` (0–59). Seconds
  elapsed in the current minute is `get_seconds()` *alone*. Getting this wrong
  yields a negative timeout and a frozen clock.
- **`this` is `undefined` at ESM top level**, so the GNOME 40 `this.dir` pattern
  throws. Use `import.meta.url` — it resolves to *this* file, so take
  `path_get_dirname` before appending a sibling filename.
- A module that **threw during import is cached as failed** and never retried.
- **The displayed hour is the *base* hour, not the wall clock's.** At 21:35 the
  big number reads `10` (base hour 22), so anything keyed off `date.getHours()` —
  e.g. the night colour band — is an hour out for half of every hour. Use
  `parts().base24`.
- Prefer running `enable()` under stubs in tests over reading the code. Nearly
  every bug here was a dropped step or a mis-shaped dependency argument that
  tests caught in a second.

## Useful references

The shell's own JavaScript is embedded in `/usr/lib/gnome-shell/libshell-18.so`
and can be read with `strings -n 5` — there is no `Shell-*.gir` and no
`.gir` for `Main.panel`, so types will not help you.