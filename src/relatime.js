// Pure formatter: no GI imports, runs under GJS and Node.
// Relative-hour notation: minutes against the NEAREST hour, :30 -> later hour.
//   07:59 -> 8:-01      08:20 -> 8:+20      08:30 -> 9:-30

const BOUNDARY_MINUTE = 30;

export function parts(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const beforeNext = minutes >= BOUNDARY_MINUTE;
    const base24 = (hours + (beforeNext ? 1 : 0)) % 24;
    return {
        hour: base24 % 12 === 0 ? 12 : base24 % 12,
        base24,
        sign: beforeNext ? '-' : '+',
        offset: beforeNext ? 60 - minutes : minutes,
    };
}

const DISPLAY_STEP_MINUTES = 5;

export function roundOffset(offset) {
const clamped = Math.max(-RAMP_MINUTES, Math.min(RAMP_MINUTES, offset));
    const magnitude = Math.round(Math.abs(clamped) / DISPLAY_STEP_MINUTES);
    return (clamped < 0 ? -1 : 1) * magnitude * DISPLAY_STEP_MINUTES + 0;
}

const NIGHT_FROM_HOUR = 22;
const NIGHT_TO_HOUR = 5;

export function isNightHour(hours24) {
    return hours24 >= NIGHT_FROM_HOUR || hours24 < NIGHT_TO_HOUR;
}

const RAMP_MINUTES = 30;

// Banded ramp, not a gradient: colour is the only direction cue (no +/- drawn).
// t is not proportional to band: t=0.30 at band 1, because a 1/30 lerp is
// indistinguishable from white.
const RAMP_STOPS = [
    {band: 0, t: 0.00},
    {band: 1, t: 0.30},
    {band: 5, t: 0.52},
    {band: 10, t: 0.67},
    {band: 15, t: 0.78},
    {band: 20, t: 0.89},
    {band: 25, t: 1.00},
    {band: 30, t: 1.00},
];

const RAMP_RGB = {negative: [0xcc, 0x32, 0x23], zero: [0xff, 0xff, 0xff], positive: [0x34, 0x8e, 0x32]};

function rampStop(offset) {
    const magnitude = Math.min(Math.abs(offset), RAMP_MINUTES);
    return RAMP_STOPS.filter(s => s.band <= magnitude).at(-1);
}

// Precompute all 61 possible colors.
const COLOR_TABLE = [];
for (let o = -RAMP_MINUTES; o <= RAMP_MINUTES; o++) {
    const {t} = rampStop(o);
    const base = RAMP_RGB.zero;
    const end = o < 0 ? RAMP_RGB.negative : RAMP_RGB.positive;
    COLOR_TABLE[o + RAMP_MINUTES] = '#' +
        base.map((v, i) => Math.round(v + (end[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function offsetColor(offset) {
    const clamped = Math.max(-RAMP_MINUTES, Math.min(RAMP_MINUTES, offset));
    return COLOR_TABLE[clamped + RAMP_MINUTES];
}
