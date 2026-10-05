import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BOUNDARY_MINUTE, MINUTES_IN_DAY, NIGHT_FROM_HOUR, NIGHT_TO_HOUR,
    RAMP_COLORS, RAMP_MINUTES, RAMP_STOPS,
    format, formatExact, formatMarkup, isNightHour, offsetColor, parts, parse,
    rampStop,
} from '../src/relatime.js';

/** Local Date at a given minute-of-day. */
function at(minutesOfDay) {
    const d = new Date(2024, 0, 1, 0, 0, 0, 0);
    d.setMinutes(minutesOfDay);
    return d;
}

test('the documented examples', () => {
    assert.equal(format(at(7 * 60 + 59)), '8:-01');
    assert.equal(format(at(8 * 60 + 0)), '8:+00');
    assert.equal(format(at(8 * 60 + 20)), '8:+20');
    assert.equal(format(at(8 * 60 + 29)), '8:+29');
    assert.equal(format(at(8 * 60 + 30)), '9:-30');
    assert.equal(format(at(8 * 60 + 50)), '9:-10');
    assert.equal(format(at(1 * 60 + 30)), '2:-30');   // "halb zwei"
});

test('the :30 boundary belongs to the later hour', () => {
    assert.equal(format(at(3 * 60 + 29)), '3:+29');
    assert.equal(format(at(3 * 60 + 30)), '4:-30');
    assert.equal(BOUNDARY_MINUTE, 30);
});

test('every minute of the day round-trips exactly', () => {
    for (let m = 0; m < MINUTES_IN_DAY; m++) {
        const text = format(at(m));
        const parsed = parse(text);
        assert.notEqual(parsed, null, `unparseable: ${text} (minute ${m})`);
        // Display is on a 12h clock, so compare modulo half a day.
        assert.equal(parsed % (MINUTES_IN_DAY / 2), m % (MINUTES_IN_DAY / 2),
            `minute ${m} -> ${text}`);
    }
});

test('the base hour is always the nearest hour', () => {
    for (let m = 0; m < MINUTES_IN_DAY; m++) {
        const p = parts(at(m));
        assert.ok(p.offset <= BOUNDARY_MINUTE,
            `minute ${m}: offset ${p.offset} exceeds ${BOUNDARY_MINUTE}`);
    }
});

test('display range is exactly H:-30 .. H:29, contiguous', () => {
    for (let base = 1; base <= 12; base++) {
        const start = (base * 60 - 30 + MINUTES_IN_DAY) % MINUTES_IN_DAY;
        for (let i = 0; i < 60; i++) {
            const expected = i < 30
                ? `${base}:-${String(30 - i).padStart(2, '0')}`
                : `${base}:+${String(i - 30).padStart(2, '0')}`;
            assert.equal(format(at(start + i)), expected);
        }
    }
});

test('exactly one reading per half hour boundary', () => {
    // :30 is rendered as "-30" of the next hour, never as "+30".
    for (let h = 0; h < 24; h++) {
        const text = format(at(h * 60 + 30));
        assert.match(text, /:-30$/, `hour ${h}:30 -> ${text}`);
    }
});

test('midnight and noon collapse to 12', () => {
    assert.equal(format(at(0)), '12:+00');
    assert.equal(format(at(30)), '1:-30');   // half past midnight = "halb eins"
    assert.equal(format(at(12 * 60)), '12:+00');
    assert.equal(format(at(23 * 60 + 30)), '12:-30');
    assert.equal(format(at(23 * 60 + 59)), '12:-01');
});

test('24h wrap is continuous', () => {
    assert.equal(format(at(23 * 60 + 59)), '12:-01');
    assert.equal(format(at(24 * 60)), '12:+00');
});

test('parse rejects nonsense', () => {
    assert.equal(parse('13:+00'), null);   // hour out of 12h range
    assert.equal(parse('0:+00'), null);    // hours are 1..12
    assert.equal(parse('8:+31'), null);    // offset beyond the half hour
    assert.equal(parse('8:20'), null);     // missing sign
    assert.equal(parse('8:+2'), null);     // minutes not padded
    assert.equal(parse('820'), null);      // missing colon
    assert.equal(parse('nonsense'), null);
});

test('parse round-trips every valid string', () => {
    for (let h = 1; h <= 12; h++) {
        for (const sign of ['+', '-']) {
            for (let off = 0; off <= 30; off++) {
                const text = `${h}:${sign}${String(off).padStart(2, '0')}`;
                assert.notEqual(parse(text), null, text);
            }
        }
    }
});

test('formatExact is plain 24h time', () => {
    assert.equal(formatExact(at(8 * 60 + 50)), '08:50');
    assert.equal(formatExact(at(0)), '00:00');
});

test('formatMarkup tints hour, sign and minutes separately', () => {
    const colors = {hour: '#3584e4', plus: '#26a269', minus: '#e62d42', minutes: '#ffffff'};
    assert.equal(formatMarkup(at(8 * 60 + 50), colors),
        '<span foreground="#3584e4">9</span><span foreground="#e62d42">:</span><span foreground="#e62d42">-</span><span foreground="#ffffff">10</span>');
    assert.equal(formatMarkup(at(8 * 60 + 20), colors),
        '<span foreground="#3584e4">8</span><span foreground="#26a269">:</span><span foreground="#26a269">+</span><span foreground="#ffffff">20</span>');
});

test('formatMarkup omits the foreground when a colour is absent', () => {
    const inherited = {hour: '#3584e4', plus: '#26a269', minus: '#e62d42', minutes: null};
    assert.equal(formatMarkup(at(8 * 60 + 50), inherited),
        '<span foreground="#3584e4">9</span><span foreground="#e62d42">:</span><span foreground="#e62d42">-</span><span>10</span>');
});
test('night band is 22:00 up to (not including) 05:00', () => {
    assert.equal(NIGHT_FROM_HOUR, 22);
    assert.equal(NIGHT_TO_HOUR, 5);
});

test('isNightHour boundaries', () => {
    const night = [22, 23, 0, 1, 2, 3, 4];
    const day = [5, 6, 11, 12, 17, 21];
    for (const h of night)
        assert.equal(isNightHour(h), true, `${h}:00 should be night`);
    for (const h of day)
        assert.equal(isNightHour(h), false, `${h}:00 should not be night`);
});

test('every hour of the day is classified exactly one way', () => {
    for (let h = 0; h < 24; h++)
        assert.equal(typeof isNightHour(h), 'boolean', `hour ${h}`);
    assert.equal(night_count(), 7, '22,23,0,1,2,3,4 = 7 night hours');
});

function night_count() {
    let n = 0;
    for (let h = 0; h < 24; h++)
        if (isNightHour(h))
            n++;
    return n;
}

const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luma = hex => hexRgb(hex).reduce((a, v) => a + v, 0) / 3;

test('the ramp endpoints are the full colours, zero is white', () => {
    assert.equal(offsetColor(-RAMP_MINUTES), RAMP_COLORS.negative);
    assert.equal(offsetColor(RAMP_MINUTES), RAMP_COLORS.positive);
    assert.equal(offsetColor(0), RAMP_COLORS.zero);
});

test('white appears at exactly one offset: 0', () => {
    const whites = [];
    for (let o = -RAMP_MINUTES; o <= RAMP_MINUTES; o++)
        if (offsetColor(o) === RAMP_COLORS.zero)
            whites.push(o);
    assert.deepEqual(whites, [0],
        `only 0 may be white, got ${whites.join(',')}`);
});

test('+/-1 are clearly coloured, not a near-white tint', () => {
    for (const o of [-1, 1]) {
        const hex = offsetColor(o);
        assert.notEqual(hex, RAMP_COLORS.zero, `${o} must not be white`);
        const [r, g, b] = hexRgb(hex);
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        assert.ok(spread >= 25,
            `${o} -> ${hex} is too close to white to read as a colour`);
    }
});

test('stops are strictly increasing in band and t', () => {
    for (let i = 1; i < RAMP_STOPS.length; i++) {
        assert.ok(RAMP_STOPS[i].band > RAMP_STOPS[i - 1].band, 'bands must increase');
        assert.ok(RAMP_STOPS[i].t >= RAMP_STOPS[i - 1].t, 't must not decrease');
    }
});

test('rampStop picks the largest band at or below the magnitude', () => {
    assert.equal(rampStop(0).band, 0);
    assert.equal(rampStop(4).band, 1);
    assert.equal(rampStop(5).band, 5);
    assert.equal(rampStop(-27).band, 25, 'sign must not affect the band');
    assert.equal(rampStop(999).band, RAMP_MINUTES);
});

test('offsets inside one band share a colour', () => {
    const stops = RAMP_STOPS.filter(s => s.band > 0);
    stops.forEach(({band}, i) => {
        const next = stops[i + 1]?.band ?? RAMP_MINUTES + 1;
        for (let o = band; o < Math.min(next, RAMP_MINUTES + 1); o++) {
            assert.equal(offsetColor(-o), offsetColor(-band),
                `-${o} and -${band} must be in the same band`);
            assert.equal(offsetColor(o), offsetColor(band),
                `+${o} and +${band} must be in the same band`);
        }
    });
});

test('the ramp darkens away from the hour on both sides', () => {
    for (let i = 1; i < RAMP_STOPS.length; i++) {
        const b = RAMP_STOPS[i].band, a = RAMP_STOPS[i - 1].band;
        assert.ok(luma(offsetColor(-b)) <= luma(offsetColor(-a)), `red side at -${b}`);
        assert.ok(luma(offsetColor(b)) <= luma(offsetColor(a)), `green side at +${b}`);
    }
});

test('red side stays red, green side stays green', () => {
    for (const {band} of RAMP_STOPS.filter(s => s.band > 0)) {
        const r = hexRgb(offsetColor(-band)), g = hexRgb(offsetColor(band));
        assert.ok(r[0] > r[1] && r[0] > r[2], `-${band} must be reddish`);
        assert.ok(g[1] >= g[0] && g[1] > g[2], `+${band} must be greenish`);
    }
});

test('offsetColor clamps out-of-range and tolerates custom colours', () => {
    assert.equal(offsetColor(-999), offsetColor(-RAMP_MINUTES));
    assert.equal(offsetColor(999), offsetColor(RAMP_MINUTES));
    const custom = {negative: '#000000', zero: '#000000', positive: '#000000'};
    assert.equal(offsetColor(12, custom), '#000000');
});
