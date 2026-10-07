// relatime implementation.
//
// NOT an ES module: this file is an expression that evaluates to a factory,
// and extension.js re-evaluates it on every enable() so that edits show up
// without restarting the shell. Do not use `import` here -- everything it
// needs arrives as an argument.

deps => {
    const {
        Clutter, GLib, GObject, St, Main, PanelMenu, uuid, dir,
    } = deps;

    /**
     * Load the formatter from disk rather than having the shim import it.
     *
     * The shim's own imports are cached for the shell's lifetime, so a static
     * import there would freeze src/relatime.js until a restart. Reading it
     * per enable() keeps the whole project hot-reloadable.
     */
    function loadCore() {
        const path = GLib.build_filenamev([dir, 'src', 'relatime.js']);
        const [, bytes] = GLib.file_get_contents(path);
        if (!bytes)
            throw new Error(`relatime: cannot read ${path}`);

        // src/relatime.js is an ES module and Node's test suite imports it as
        // one. Turn it into an expression by dropping the `export` keywords.
        const source = new TextDecoder().decode(bytes)
            .replace(/^export\s+(?=(function|const|let|var|class)\s)/gm, '');

        return eval(`(() => {
            ${source}
            return {parts, format, formatMarkup, formatExact, parse, isNightHour,
                    offsetColor, roundOffset};
        })()`);
    }

    const {parts, formatExact, isNightHour, offsetColor, roundOffset} = loadCore();

    // Colours live in stylesheet.css. Three separate labels instead of one
    // Pango-markup label: a `foreground` attribute on the first span of a
    // markup label was not being applied, and CSS colours on St widgets are
    // easier to reason about and to override later.

    // Update a moment after the minute flips, like the stock clock.
    const TICK_SLACK_SECONDS = 0.5;
    const TOOLTIP_DELAY_MS = 400;

    // GType names are process-global and may only be registered once, but we
    // re-register our classes on every reload. So the counter has to survive
    // re-evaluation of this file: keep it on globalThis, not in a local.
    // (Reloads do leak one GType each; harmless, and unavoidable.)
    const gtypeCounter = (globalThis.__relatimeGTypeCounter ??= {n: 0});
    const registerClass = klass => GObject.registerClass(
        {GTypeName: `Relatime_${gtypeCounter.n++}`}, klass);

    /**
     * GNOME 50 removed tooltip support from St entirely (no tooltip-text
     * property, no set_tooltip_text), so we bring our own hover tooltip.
     */
    const HoverTooltip = registerClass(
    class HoverTooltip extends St.Label {
        _init(widget) {
            super._init({
                style_class: 'relatime-tooltip',
                visible: false,
            });
            this._widget = widget;
            this._timeoutId = 0;

            widget.connect('notify::hover', () => {
                if (widget.hover)
                    this.open();
                else
                    this.close();
            });
        }

        setText(text) {
            this.set_text(text);
        }

        open() {
            if (this._timeoutId)
                return;
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
                this._timeoutId = 0;
                this.opacity = 0;
                this.show();

                const extents = this._widget.get_transformed_extents();
                // Math.clamp() does not exist in gjs 1.88, even though some of
                // GNOME's own sources call it - so clamp by hand.
                const x = Math.max(0, Math.min(
                    extents.get_x() + Math.floor((extents.get_width() - this.width) / 2),
                    Math.max(0, global.stage.width - this.width)));
                const y = extents.get_y() + extents.get_height();

                this.set_position(x, y);
                this.remove_all_transitions();
                this.ease({
                    opacity: 255,
                    duration: 120,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                return GLib.SOURCE_REMOVE;
            });
            GLib.Source.set_name_by_id(this._timeoutId, '[relatime] tooltip.open');
        }

        close() {
            if (this._timeoutId) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = 0;
                return;
            }
            if (!this.visible)
                return;
            this.remove_all_transitions();
            this.ease({
                opacity: 0,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this.hide(),
            });
        }

        destroy() {
            if (this._timeoutId) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = 0;
            }
            Main.layoutManager.removeChrome(this);
            super.destroy();
        }
    });

    const RelatimeButton = registerClass(
    class RelatimeButton extends PanelMenu.Button {
        _init() {
            // dontCreateMenu: this button has no popup to offer. The stock
            // clock's calendar menu is not reimplemented.
            super._init(0.0, 'Relatime', true);

            this.x_align = Clutter.ActorAlign.CENTER;
            this.y_align = Clutter.ActorAlign.CENTER;

            const part = extra => new St.Label({
                style_class: `relatime-part ${extra}`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const hourLabel = part('relatime-hour');
            const colonLabel = part('relatime-colon');
            // No +/- is drawn: the colour of the minutes is the only cue for
            // which side of the hour we are on, so the ramp has to be legible
            // on its own (see RAMP_STOPS in src/relatime.js).
            const minutesLabel = part('relatime-minutes');
            // The exact figure, in small white text beside the coarse one.
            const exactLabel = part('relatime-exact');

            this._display = new St.BoxLayout({
                style_class: 'relatime-display',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._display.add_child(hourLabel);
            this._display.add_child(colonLabel);
            this._display.add_child(minutesLabel);
            this._display.add_child(exactLabel);
            this.add_child(this._display);

            // Only touch the night class when it actually changes: re-adding it
            // every minute would restyle the widget for nothing.
            this._nightApplied = null;

            this._setTime = now => {
                const {hour, sign, minutes, base24} = parts(now);

                hourLabel.set_text(String(hour));
                colonLabel.set_text(':');

                const signed = sign === '-' ? -Number(minutes) : Number(minutes);

                // The big figure snaps to whole fives; the exact one rides
                // beside it in small text. No leading zeros either way, and a
                // minus only when the offset is negative.
                const show = v => `${v < 0 ? '-' : ''}${Math.abs(v)}`;
                const rounded = roundOffset(signed);
                minutesLabel.set_text(show(rounded));
                // Always shown, even when it agrees with the coarse figure.
                exactLabel.set_text(show(signed));

                // Banded ramp: white only when the offset is exactly zero.
                // St.Widget.set_style() takes ONE argument: a CSS declaration
                // string. Passing (property, value) throws "Too many arguments"
                // and silently applies nothing.
                minutesLabel.set_style(`background-color: ${offsetColor(rounded)};`);

                // The BASE hour, not the wall clock's: at 21:35 the big number
                // already reads 10 (base hour 22), so it must already be blue.
                const wantNight = isNightHour(base24) ? 'relatime-night' : null;
                if (wantNight !== this._nightApplied) {
                    if (this._nightApplied)
                        hourLabel.remove_style_class_name(this._nightApplied);
                    if (wantNight)
                        hourLabel.add_style_class_name(wantNight);
                    this._nightApplied = wantNight;
                }
            };

            this.refresh();
        }

        refresh(now = new Date()) {
            this._setTime(now);
            this.tooltip?.setText(formatExact(now));
        }

        /** ms until the next minute boundary (plus a little slack). */
        static msToNextMinute() {
            const now = GLib.DateTime.new_now_local();
            // Only the seconds matter: get_minute() is the minute within the
            // hour, not minutes since midnight (there is no get_minutes() in
            // the bindings). What we want is seconds elapsed in this minute.
            const elapsed = now.get_seconds();
            return (60 - elapsed + TICK_SLACK_SECONDS) * 1000;
        }

        armTick() {
            this.disarmTick();
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                RelatimeButton.msToNextMinute(), () => {
                    this._tickId = 0;
                    this.refresh();
                    this.armTick();
                    return GLib.SOURCE_REMOVE;
                });
        }

        disarmTick() {
            if (this._tickId) {
                GLib.Source.remove(this._tickId);
                this._tickId = 0;
            }
        }

        destroy() {
            this.disarmTick();
            super.destroy();
        }
    });

    // A plain object, not a class: the shim re-evaluates this factory on every
    // enable(), so this must be constructible more than once per process.
    return {
        enable() {
            this._button = new RelatimeButton();

            this._tooltip = new HoverTooltip(this._button);
            Main.layoutManager.addChrome(this._tooltip, {trackFullscreen: false});
            this._button.tooltip = this._tooltip;

            // 'center' is where the stock clock lives, so the label lands
            // exactly where the clock it replaces was.
            Main.panel.addToStatusArea(uuid, this._button, 0, 'center');
            this._button.armTick();

            this._hideNativeClock();
        },

        disable() {
            this._button?.destroy();
            this._button = null;

            this._tooltip?.destroy();
            this._tooltip = null;

            this._restoreNativeClock();
        },

        /**
         * Hide the stock clock, two ways at once.
         *
         * 1. Drop the 'dateMenu' role from Main.sessionMode.panel, which is the
         *    mechanism GNOME 50 itself uses to decide panel contents, so the
         *    clock stays out across panel rebuilds.
         * 2. Hide the button's container directly, and re-hide on session-mode
         *    changes. This is the belt to the role list's braces: whether the
         *    role array we mutate is the shell's own object or a fresh copy
         *    varies, and we should not depend on that.
         */
        _hideNativeClock() {
            const clock = Main.panel.statusArea?.dateMenu;
            if (clock?.container) {
                this._hiddenContainer = clock.container;
                this._hiddenContainer.hide();
                this._modeChangedId = Main.sessionMode?.connect('updated',
                    () => this._hiddenContainer?.hide());
            } else {
                console.error('[relatime] cannot find Main.panel.statusArea.dateMenu');
            }

            const roles = Main.sessionMode?.panel;
            if (roles) {
                for (const box of ['left', 'center', 'right']) {
                    const list = roles[box];
                    const index = list?.indexOf('dateMenu') ?? -1;
                    if (index >= 0) {
                        list.splice(index, 1);
                        (this._removedRole ??= []).push({box, index});
                    }
                }
                if (this._removedRole?.length)
                    Main.panel._updatePanel();
            }

            console.log('[relatime] stock clock hidden');
        },

        _restoreNativeClock() {
            if (this._modeChangedId) {
                Main.sessionMode.disconnect(this._modeChangedId);
                this._modeChangedId = 0;
            }
            if (this._hiddenContainer) {
                this._hiddenContainer.show();
                this._hiddenContainer = null;
            }
            for (const {box, index} of this._removedRole ?? [])
                Main.sessionMode.panel[box].splice(index, 0, 'dateMenu');
            this._removedRole = null;
            Main.panel._updatePanel();
        },
    };
}
