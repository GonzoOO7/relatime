// Proves src/relatime.js runs under GJS/SpiderMonkey, not just Node.
import {parts} from '../src/relatime.js';

const d = new Date();
d.setHours(8, 50, 0, 0);

const checks = [
    [parts(d).offset === 10, `parts().offset -> ${parts(d).offset}`],
    [parts(d).hour === 9, `parts().hour -> ${parts(d).hour}`],
];

for (const [ok, what] of checks) {
    print(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok)
        imports.system.exit(1);
}
print('gjs smoke test passed');
