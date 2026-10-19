import test from 'node:test';
import assert from 'node:assert/strict';

import {parts, isNightHour, offsetColor, roundOffset} from '../src/relatime.js';

function at(minutesOfDay) {
    const d = new Date(2024, 0, 1, 0, 0, 0, 0);
    d.setMinutes(minutesOfDay);
    return d;
}

test('parts: base hour is the nearest hour', () => {
    for (let m = 0; m < 1440; m++) {
        const p = parts(at(m));
        assert.ok(p.offset <= 30, `minute ${m}: offset ${p.offset} exceeds 30`);
    }
});

test('parts: display range is H:-30 .. H:29', () => {
    for (let base = 1; base <= 12; base++) {
        const start = (base * 60 - 30 + 1440) % 1440;
        for (let i = 0; i < 60; i++) {
            const p = parts(at(start + i));
            assert.equal(p.offset, i < 30 ? 30 - i : i - 30, `minute ${start + i}`);
            assert.equal(p.sign, i < 30 ? '-' : '+', `minute ${start + i}`);
        }
    }
});

test('parts: midnight and noon collapse to 12', () => {
    assert.equal(parts(at(0)).hour, 12);
    assert.equal(parts(at(30)).hour, 1);
    assert.equal(parts(at(12 * 60)).hour, 12);
    assert.equal(parts(at(23 * 60 + 30)).hour, 12);
});

test('isNightHour: 22:00 up to (not including) 05:00', () => {
    const night = [22, 23, 0, 1, 2, 3, 4];
    const day = [5, 6, 11, 12, 17, 21];
    for (const h of night)
        assert.equal(isNightHour(h), true, `${h}:00 should be night`);
    for (const h of day)
        assert.equal(isNightHour(h), false, `${h}:00 should not be night`);
});

test('roundOffset: snaps to multiples of 5', () => {
    assert.equal(roundOffset(0), 0);
    assert.equal(roundOffset(2), 0);
    assert.equal(roundOffset(3), 5);
    assert.equal(roundOffset(7), 5);
    assert.equal(roundOffset(8), 10);
    assert.equal(roundOffset(-2), 0);
    assert.equal(roundOffset(-3), -5);
    assert.equal(roundOffset(-7), -5);
    assert.equal(roundOffset(-8), -10);
});

test('roundOffset: clamps to +/-30', () => {
    assert.equal(roundOffset(999), 30);
    assert.equal(roundOffset(-999), -30);
});

const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

test('offsetColor: endpoints are full colours, zero is white', () => {
    assert.equal(offsetColor(-30), '#cc3223');
    assert.equal(offsetColor(30), '#348e32');
    assert.equal(offsetColor(0), '#ffffff');
});

test('offsetColor: white only at 0', () => {
    const whites = [];
    for (let o = -30; o <= 30; o++)
        if (offsetColor(o) === '#ffffff')
            whites.push(o);
    assert.deepEqual(whites, [0]);
});

test('offsetColor: +/-1 are clearly coloured', () => {
    for (const o of [-1, 1]) {
        const hex = offsetColor(o);
        assert.notEqual(hex, '#ffffff', `${o} must not be white`);
        const [r, g, b] = hexRgb(hex);
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        assert.ok(spread >= 25, `${o} -> ${hex} is too close to white`);
    }
});

test('offsetColor: clamps out-of-range', () => {
    assert.equal(offsetColor(-999), offsetColor(-30));
    assert.equal(offsetColor(999), offsetColor(30));
});
