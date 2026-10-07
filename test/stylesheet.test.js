import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const impl = readFileSync(`${ROOT}impl.js`, 'utf8');
const css = readFileSync(`${ROOT}stylesheet.css`, 'utf8');

// Every style class the code puts on a widget must have a rule, or the widget
// silently falls back to whatever .relatime-part sets - which for the exact
// figure means black text on a dark panel: invisible, with no error anywhere.
const classes = new Set();
for (const m of impl.matchAll(/'(relatime-[a-z-]+)'/g))
    classes.add(m[1]);
for (const m of impl.matchAll(/`(relatime-[a-z-]+)(?:\s|\$| )/g))
    classes.add(m[1]);

test('impl.js puts style classes on widgets', () => {
    assert.ok(classes.size >= 5,
        `expected to find style classes, found: ${[...classes]}`);
});

// Classes with no rule on purpose: .relatime-minutes gets its background
// per tick from set_style(), so a static rule would only be misleading.
const RUNTIME_STYLED = new Set(['relatime-minutes']);

for (const cls of classes) {
    test(`stylesheet.css has a rule for .${cls}`, () => {
        if (RUNTIME_STYLED.has(cls)) {
            assert.match(impl, /set_style\(`background-color/,
                `${cls} is exempt only while set_style really styles it`);
            return;
        }
        assert.match(css, new RegExp(`\\.${cls}(?![a-z-])`),
            `.${cls} is used in impl.js but has no rule in stylesheet.css`);
    });
}

test('rules that override .relatime-part come after it', () => {
    // .relatime-part and these selectors have equal specificity, so source
    // order decides. Getting it wrong silently renders the wrong colour.
    const order = [...css.matchAll(/^\.([a-z-]+)/gm)].map(m => m.index);
    const partIndex = css.indexOf('.relatime-part {');
    for (const cls of ['relatime-colon', 'relatime-exact']) {
        const i = css.indexOf(`.${cls} {`);
        assert.ok(i > partIndex, `.${cls} must be declared after .relatime-part`);
    }
});