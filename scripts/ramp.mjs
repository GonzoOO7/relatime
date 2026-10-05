#!/usr/bin/env node
// Print the minutes colour ramp, with each hex drawn in its own colour.
//
//   node scripts/ramp.mjs          # one row per 5-minute band
//   node scripts/ramp.mjs --all    # every minute, -30..+29
//
// Uses 24-bit truecolor. If your terminal shows the escape codes as literal
// text ([[38;2;...), it does not support truecolor - try `less -R`.)

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

const fg = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `\x1b[38;2;${r};${g};${b}m`;
};

const RED = '#cc3223';
const WHITE = '#ffffff';
const GREEN = '#348e32';

const RAMP = 30;   // furthest offset either side of the hour
// Mirrors RAMP_STOPS in src/relatime.js. White exists only at offset 0, so
// there is a stop at 1 that jumps straight to a clearly visible tint.
const STOPS = [
    {band: 0, t: 0.00},
    {band: 1, t: 0.30},
    {band: 5, t: 0.52},
    {band: 10, t: 0.67},
    {band: 15, t: 0.78},
    {band: 20, t: 0.89},
    {band: 25, t: 1.00},
    {band: 30, t: 1.00},
];

const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbHex = c => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Colour for a signed offset: white only at 0, out to full red/green. */
function offsetColor(offset) {
    const clamped = Math.max(-RAMP, Math.min(RAMP, offset));
    const magnitude = Math.abs(clamped);
    const t = STOPS.filter(s => s.band <= magnitude).at(-1).t;
    const end = hexRgb(clamped < 0 ? RED : GREEN);
    return rgbHex(lerp(hexRgb(WHITE), end, t));
}

const all = process.argv.includes('--all');
const offsets = [];
if (all) {
    for (let o = -RAMP; o <= 29; o++)
        offsets.push(o);
} else {
    // Negative side descending, 0, then positive ascending.
    const bands = STOPS.map(s => s.band).filter(b => b <= 25);
    offsets.push(...bands.filter(b => b > 0).map(b => -b).reverse(),
        0, ...bands.filter(b => b > 0));
}

const W = 11;
const label = o => (o > 0 ? '+' : '') + o;
const pad = (t, w = W) => t.padEnd(w);
const cell = (text, offset) => `${fg(offsetColor(offset))}${pad(text, W - 2)}${OFF}`;

console.log();
console.log(`${BOLD}relatime — minutes colour ramp${OFF} ${DIM}(${all ? 'every minute' : `${STOPS.length} bands, white only at 0`}, no sign shown)${OFF}`);
console.log();
if (all) {
    // One offset per line: too wide otherwise.
    for (const o of offsets)
        console.log(`  ${cell(label(o), o)}${cell(offsetColor(o), o)}${cell('██', o)}`);
} else {
    console.log(`${pad('offset', 13)}${offsets.map(o => cell(label(o), o)).join('')}`);
    console.log(`${pad('hex', 13)}${offsets.map(o => cell(offsetColor(o), o)).join('')}`);
    console.log(`${pad('swatch', 13)}${offsets.map(o => cell('██', o)).join('')}`);
    console.log();
    console.log(`${DIM}hour: yellow #d8be3c, blue #3d8bbd from 22:00 to 05:00.   colon: white.${OFF}`);
    console.log(`${DIM}note: no +/- is drawn - the colour is the only cue for which side of the hour.${OFF}`);
}
console.log();