// Pure formatting logic for relatime.
//
// Relative-hour notation: the minute hand is expressed against the NEAREST
// hour, with the :30 boundary resolving to the LATER hour.
//   07:59 -> 8:-01      08:20 -> 8:+20
//   08:30 -> 9:-30      01:30 -> 02:-30
// So each base hour covers the range H:-30 .. H:29.
//
// No GNOME imports on purpose: this file must run under GJS, Node and any
// future test harness without change.

export const MINUTES_IN_DAY = 1440;

/** The half-hour boundary. At exactly :30 the LATER hour wins. */
export const BOUNDARY_MINUTE = 30;

const pad2 = n => String(n).padStart(2, '0');

/**
 * Break a Date down into the parts of the relative notation.
 * @param {Date} date
 */
export function parts(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const beforeNext = minutes >= BOUNDARY_MINUTE;

    // Base hour: current hour, or the next one once we are past the halfway mark.
    const base24 = (hours + (beforeNext ? 1 : 0)) % 24;
    const hour = base24 % 12 === 0 ? 12 : base24 % 12;
    const offset = beforeNext ? 60 - minutes : minutes;

    return {
        hour,                                   // 1..12, for display
        base24,                                 // 0..23, base hour of day
        sign: beforeNext ? '-' : '+',
        minutes: pad2(offset),                  // "01".."30"
        offset,                                 // 0..30, magnitude, sign carries direction
        beforeNext,
    };
}

/** e.g. "9:-10" */
export function format(date) {
    const {hour, sign, minutes} = parts(date);
    return `${hour}:${sign}${minutes}`;
}

/** Ordinary 24h time, for the tooltip. e.g. "08:50" */
export function formatExact(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** The big number snaps to multiples of this many minutes. */
export const DISPLAY_STEP_MINUTES = 5;

/**
 * Round a signed offset to the nearest DISPLAY_STEP_MINUTES, ties away from
 * zero: -30,-29,-28 -> -30, -27..-23 -> -25, -22..-18 -> -20, and so on.
 *
 * This is the coarse figure; the exact one is shown beside it in small text.
 *
 * @param {number} offset signed minutes from the base hour, -30..30
 */
export function roundOffset(offset) {
    const clamped = Math.max(-RAMP_MINUTES, Math.min(RAMP_MINUTES, offset));
    const magnitude = Math.round(Math.abs(clamped) / DISPLAY_STEP_MINUTES);
    return (clamped < 0 ? -1 : 1) * magnitude * DISPLAY_STEP_MINUTES;
}

/** Start of the night band, in 24h hours. */
export const NIGHT_FROM_HOUR = 22;
/** End of the night band, in 24h hours (exclusive). */
export const NIGHT_TO_HOUR = 5;

/**
 * Is this hour of day within the night band? Wraps midnight, so 23 and 0 are
 * both night while 5 is not.
 * @param {number} hours24 hour of day, 0-23
 */
export function isNightHour(hours24) {
    return hours24 >= NIGHT_FROM_HOUR || hours24 < NIGHT_TO_HOUR;
}

/** Furthest offset either side of the hour that the colour ramp spans. */
export const RAMP_MINUTES = 30;

/**
 * The ramp is a set of bands, not a smooth gradient, and the sign is no
 * longer drawn - colour is the only direction cue, so the bands have to be
 * legible without it.
 *
 * `band` is the smallest offset that maps to that stop; `t` is how far the
 * colour has travelled from white towards the full red/green. They are not
 * proportional: t=0.30 already at band 1, because a 1/30 lerp is #fdf8f8 and
 * nobody could tell that from white.
 */
export const RAMP_STOPS = [
    {band: 0, t: 0.00},   // exactly on the hour, and the only white there is
    {band: 1, t: 0.30},
    {band: 5, t: 0.52},
    {band: 10, t: 0.67},
    {band: 15, t: 0.78},
    {band: 20, t: 0.89},
    {band: 25, t: 1.00},
    {band: 30, t: 1.00},
];

/** Default ramp: full red at -30, white on the hour, full green at +30. */
export const RAMP_COLORS = {negative: '#cc3223', zero: '#ffffff', positive: '#348e32'};

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = rgb =>
    `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * The ramp stop for a signed offset: `{band, t}`.
 * @param {number} offset signed minutes from the base hour
 */
export function rampStop(offset) {
    const magnitude = Math.min(Math.abs(offset), RAMP_MINUTES);
    return RAMP_STOPS.filter(s => s.band <= magnitude).at(-1);
}

/**
 * Colour for a signed minute offset: white only when the offset is exactly
 * zero, otherwise banded from white out to the full red/green.
 *
 * @param {number} offset signed minutes from the base hour, -30..30
 * @param {{negative: string, zero: string, positive: string}} [colors]
 * @returns {string} `#rrggbb`
 */
export function offsetColor(offset, colors = RAMP_COLORS) {
    const {negative, zero, positive} = {...RAMP_COLORS, ...colors};
    const clamped = Math.max(-RAMP_MINUTES, Math.min(RAMP_MINUTES, offset));
    const {t} = rampStop(clamped);

    const base = hexToRgb(zero);
    const end = hexToRgb(clamped < 0 ? negative : positive);
    return rgbToHex(base.map((v, i) => v + (end[i] - v) * t));
}

/**
 * Pango markup with hour and sign tinted separately.
 * @param {Date} date
 * @param {{hour: string, plus: string, minus: string, minutes?: string|null}} colors
 *        A null/undefined colour emits no foreground, so it inherits the label's.
 */
export function formatMarkup(date, colors) {
    const {hour, sign, minutes} = parts(date);
    const span = (text, color) => color
        ? `<span foreground="${color}">${text}</span>`
        : `<span>${text}</span>`;

    const signColor = sign === '-' ? colors.minus : colors.plus;
    return span(hour, colors.hour) +
           span(':', signColor) +
           span(sign, signColor) +
           span(minutes, colors.minutes ?? null);
}

/**
 * Inverse of format(): minutes-of-day (mod 1440) of the time a string denotes.
 * Returns null if the string is not valid relatime.
 * @param {string} text
 */
export function parse(text) {
    const m = /^(\d{1,2}):([+-])(\d{2})$/.exec(text);
    if (!m)
        return null;

    const hour = Number(m[1]);
    const offset = Number(m[3]);
    if (hour < 1 || hour > 12 || offset > BOUNDARY_MINUTE)
        return null;

    const base = (hour % 12) * 60;
    return m[2] === '-'
        ? (base - offset + MINUTES_IN_DAY) % MINUTES_IN_DAY
        : (base + offset) % MINUTES_IN_DAY;
}
