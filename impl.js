// NOT an ES module: an expression evaluating to a factory, re-eval'd per enable().
// No imports here -- everything arrives as an argument.

deps => {
    const {Clutter, GLib, GObject, St, Main, PanelMenu, uuid, dir} = deps;

    function loadCore() {
        const path = GLib.build_filenamev([dir, 'src', 'relatime.js']);
        const [, bytes] = GLib.file_get_contents(path);
        if (!bytes)
            throw new Error(`relatime: cannot read ${path}`);
        // Strip `export` so the ES module source can be eval'd as an expression.
        const source = new TextDecoder().decode(bytes)
            .replace(/^export\s+(?=(function|const|let|var|class)\s)/gm, '');
        return eval(`(() => {
            ${source}
            return {parts, isNightHour, offsetColor, roundOffset};
        })()`);
    }

    const {parts, isNightHour, offsetColor, roundOffset} = loadCore();

    const TICK_SLACK_SECONDS = 0.5;
    const TOOLTIP_DELAY_MS = 400;

    // GType names are process-global; counter must survive re-evaluation.
    const gtypeCounter = (globalThis.__relatimeGTypeCounter ??= {n: 0});
    const registerClass = klass => GObject.registerClass(
        {GTypeName: `Relatime_${gtypeCounter.n++}`}, klass);

    // GNOME 50 removed St tooltips; this is our own.
    const HoverTooltip = registerClass(
    class HoverTooltip extends St.Label {
        _init(widget) {
            super._init({style_class: 'relatime-tooltip', visible: false});
            this._widget = widget;
            this._timeoutId = 0;
            widget.connect('notify::hover', () => widget.hover ? this.open() : this.close());
        }
        setText(text) { this.set_text(text); }
        open() {
            if (this._timeoutId) return;
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
                this._timeoutId = 0;
                this.opacity = 0;
                this.show();
                const extents = this._widget.get_transformed_extents();
                // Math.clamp() does not exist in gjs 1.88.
                const x = Math.max(0, Math.min(
                    extents.get_x() + Math.floor((extents.get_width() - this.width) / 2),
                    Math.max(0, global.stage.width - this.width)));
                const y = extents.get_y() + extents.get_height();
                this.set_position(x, y);
                this.remove_all_transitions();
                this.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
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
            if (!this.visible) return;
            this.remove_all_transitions();
            this.ease({opacity: 0, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this.hide()});
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
            super._init(0.0, 'Relatime', true); // dontCreateMenu: no popup
            this.x_align = Clutter.ActorAlign.CENTER;
            this.y_align = Clutter.ActorAlign.CENTER;
            const part = extra => new St.Label({
                style_class: `relatime-part ${extra}`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const hourLabel = part('relatime-hour');
            const colonLabel = part('relatime-colon');
            const minutesLabel = part('relatime-minutes');
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
            this._nightApplied = null;
            this._setTime = now => {
                const {hour, sign, offset, base24} = parts(now);
                hourLabel.set_text(String(hour));
                colonLabel.set_text(':');
                const signed = sign === '-' ? -offset : offset;
                const show = v => `${v < 0 ? '-' : ''}${Math.abs(v)}`;
                const rounded = roundOffset(signed);
                minutesLabel.set_text(show(rounded));
                exactLabel.set_text(show(signed));
                // set_style takes ONE arg: a CSS string. Two args throws and applies nothing.
                minutesLabel.set_style(`background-color: ${offsetColor(rounded)};`);
                // Base hour, not wall clock: at 21:35 base is 22, already night.
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
            this.tooltip?.setText(GLib.DateTime.new_now_local().format('%H:%M'));
        }
        static msToNextMinute() {
            // GLib.DateTime has no get_minutes(); get_seconds() alone is seconds
            // elapsed in the current minute.
            const elapsed = GLib.DateTime.new_now_local().get_seconds();
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

    return {
        enable() {
            this._button = new RelatimeButton();
            this._tooltip = new HoverTooltip(this._button);
            Main.layoutManager.addChrome(this._tooltip, {trackFullscreen: false});
            this._button.tooltip = this._tooltip;
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
