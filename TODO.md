# relatime — GNOME panel clock in "relative hour" notation

## The idea

Instead of `08:50`, show `9:-10`: the time expressed against the **nearest**
hour, with the `:30` boundary resolving to the *later* hour. Each base hour
covers the range `H:-30 … H:29`.

```
21:58 → 10:-02     before 10
22:00 → 10:+00     on the hour
08:20 →  8:+20     after 8
08:30 →  9:-30     (= "halb neun")
13:50 →  2:-10     on a 12-hour clock
```

Numbers only. The German word forms were just the intuition for where the
boundary sits — `halb drei` literally *is* `3:-30`, and `zwanzig nach neun`
literally *is* `9:+20`, so the scheme and the language agree.

## Where things stand

**Working.** `State: ACTIVE`, no errors, 31 tests + 2 GJS suites green, and the
edit → `reload.sh` loop works without restarting the shell.

## Spec (as decided)

| rule | value |
|---|---|
| boundary | `m >= 30` → base hour is the next one, sign `-`; else same hour, sign `+` |
| numbering | 12-hour; `0` and `24` both render as `12` |
| minutes | always 2-digit zero-padded (`+05`, `-01`) |
| sign | always explicit (`+` / `-`) |
| precision | exact minutes, no rounding |
| language | none — numbers only |
| hour colour | yellow `#d8be3c`, turning **blue** `#3d8bbd` from 22:00 to 05:00 |
| colon | white `#ffffff` |
| `+MM` | green `#348e32` |
| `-MM` | red `#cc3223` |
| clock popup | the native calendar/notifications popup is **not** reimplemented — accepted trade-off |

## The plan, and where each stage ended up

### Stage 0 — de-risk the GNOME 50 API ✅
The unknown was whether an extension could replace the panel clock at all.
Answer: yes, but every pre-45 tutorial is wrong about how. Found by extracting
the shell's own JavaScript from `libshell-18.so`. See `REFERENCE.md`.

### Stage 1 — pure core, no GNOME ✅
`src/relatime.js`: `parts()`, `format()`, `formatMarkup()`, `formatExact()`,
`parse()`, `isNightHour()`. No GI imports, so it runs under both Node and GJS.
The strongest test is the **round trip**: for all 1440 minutes of a day,
`format()` → `parse()` → equal. That proves the range has no gaps, no
ambiguities, and that `:30` is claimed by exactly one reading.

### Stage 2 — the extension shell ✅
`metadata.json`, the frozen `extension.js` shim, `impl.js`, `stylesheet.css`,
install/reload/status scripts. Hiding the stock clock, wall-clock-aligned minute
tick, tri-colour display, hover tooltip.

### Stage 3 — make it survivable ✅
This was the stage that actually mattered, and it was not in the original plan.
It produced `AGENTS.md` (the rules that stop restarts) and the tests that run
`enable()` for real.

### Stage 4 — future work ⬜
- [ ] click action on the clock (currently inert)
- [ ] optionally recover the native calendar popup and bind it to our button
- [ ] theme-aware colours — the hex values are hardcoded and assume a dark panel
- [ ] prefs UI (`gnome-extensions prefs`) if there are ever settings
- [ ] `gnome-extensions pack` for distribution
- [ ] README, so the "listed but not loaded" confusion is documented for humans

## Deferred: fullscreen-replacement polish
- [ ] **Flicker on conversion** - undoing fullscreen snaps the window down in size,
      a visible flash on every F11. Accepted for now, revisit later (pre-animation? convert
      before the surface is shown?).
- [ ] **Debounce per window** - remember which windows were already converted and ignore their
      re-requests, so apps that re-assert fullscreen on focus cannot ping-pong.

## Development loop

```bash
npm test                        # 42 tests
gjs -m test/smoke.gjs.js        # pure core under GJS
gjs -m test/smoke-shim.gjs.js   # real extension.js under GJS, end to end
./scripts/reload.sh             # apply, ~1s, no restart
./scripts/status.sh             # D-Bus state + errors, current-session log
node scripts/ramp.mjs           # minutes colour ramp, printed in colour
```

Run all three test commands before `reload.sh`. See `AGENTS.md` for what must
not be touched and why, and `REFERENCE.md` for the underlying GNOME facts.