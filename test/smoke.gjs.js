// Proves src/relatime.js runs under GJS/SpiderMonkey, not just Node.
// Any Node-only API in the core would blow up here.
import {format, formatExact, parts} from '../src/relatime.js';

const d = new Date();
d.setHours(8, 50, 0, 0);

const checks = [
    [format(d) === '9:-10', `format() -> ${format(d)}`],
    [formatExact(d) === '08:50', `formatExact() -> ${formatExact(d)}`],
    [parts(d).offset === 10, `parts().offset -> ${parts(d).offset}`],
];

for (const [ok, what] of checks) {
    print(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok)
        imports.system.exit(1);
}
print('gjs smoke test passed');