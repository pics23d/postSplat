// [custom] Summarize a SpaceMouse debug dump into the calibration table
// (~/.claude/spacemouse-knowledge/05-calibration-procedure.md).
//
// 1. Launch with the raw dump on and a log file:
//      node scripts/desktop-start.mjs --log-file=D:\tmp\sm.log
//    then in the app enable the dump (Preferences → or ?spacemouseDebug=1 / CDP:
//      node scripts/cdp-eval.mjs "window.scene.events.fire('spacemouse.setDebug', true)")
// 2. Perform the six pure gestures IN ORDER, pausing ~1 s between them:
//      slide cap right · push cap away · lift cap · tilt cap nose-down ·
//      tilt cap top to the right · twist cap clockwise (seen from above)
//    then press each button once, pausing between presses.
// 3. node scripts/spacemouse-calibrate.mjs D:\tmp\sm.log
//
// Output: one row per detected burst with the dominant raw axis and its sign, plus the
// button presses seen. Compare against the desired-action column and set DEFAULT_SIGNS
// in src/spacemouse/controller.ts so each gesture maps to its fly action.

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
    console.error('usage: node scripts/spacemouse-calibrate.mjs <renderer log with [spacemouse] lines>');
    process.exit(2);
}

const GAP_MS = 800;
const AXES = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'];
const GESTURES = [
    'slide cap right      -> strafe right',
    'push cap away        -> fly forward',
    'lift cap             -> move up (world)',
    'tilt cap nose-down   -> pitch down',
    'tilt cap top-right   -> roll right (unused: no roll)',
    'twist cap clockwise  -> yaw right'
];
const BUTTONS = {
    0: 'MENU', 1: 'FIT', 2: 'TOP', 4: 'RIGHT', 5: 'FRONT', 8: 'ROLL_CW',
    12: 'KEY_1', 13: 'KEY_2', 14: 'KEY_3', 15: 'KEY_4', 22: 'ESC', 23: 'ALT', 24: 'SHIFT', 25: 'CTRL', 26: 'ROTATE'
};

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const samples = [];
const presses = [];
let lastMask = 0;

for (const line of lines) {
    const m = line.match(/^(\S+) .*\[spacemouse\] id=(\d+) \[([0-9a-f ]*)\] -> (\{.*?\})(?: \(|$)/);
    if (!m) continue;
    const time = Date.parse(m[1]);
    let report;
    try {
        report = JSON.parse(m[4]);
    } catch {
        continue;
    }
    if (report.kind === 'translation' || report.kind === 'rotation' || report.kind === 'combined') {
        const axes = report.kind === 'combined' ? report.axes : report;
        samples.push({ time, axes });
    } else if (report.kind === 'buttons') {
        const pressed = report.mask & ~lastMask;
        lastMask = report.mask;
        for (let bit = 0; bit < 32; bit++) {
            if (pressed & (1 << bit)) {
                presses.push({ time, bit, name: BUTTONS[bit] ?? `bit${bit}` });
            }
        }
    }
}

if (samples.length === 0) {
    console.error('no [spacemouse] axis reports found — is the debug dump enabled?');
    process.exit(1);
}

// segment into bursts by time gaps, dropping all-zero stop packets
const bursts = [];
let current = null;
for (const s of samples) {
    const magnitude = AXES.reduce((acc, a) => acc + Math.abs(s.axes[a] ?? 0), 0);
    if (magnitude === 0) continue;
    if (!current || s.time - current.end > GAP_MS) {
        current = { start: s.time, end: s.time, sums: Object.fromEntries(AXES.map(a => [a, 0])), peaks: Object.fromEntries(AXES.map(a => [a, 0])), count: 0 };
        bursts.push(current);
    }
    current.end = s.time;
    current.count++;
    for (const a of AXES) {
        const v = s.axes[a] ?? 0;
        current.sums[a] += v;
        if (Math.abs(v) > Math.abs(current.peaks[a])) current.peaks[a] = v;
    }
}

console.log(`bursts: ${bursts.length}   axis reports: ${samples.length}   button presses: ${presses.length}\n`);
console.log('#  duration  reports  dominant  sign  peak    secondary            expected gesture');
bursts.forEach((b, i) => {
    const ranked = AXES.map(a => ({ a, s: b.sums[a] })).sort((x, y) => Math.abs(y.s) - Math.abs(x.s));
    const dom = ranked[0];
    const secondary = ranked.slice(1, 3).filter(r => Math.abs(r.s) > Math.abs(dom.s) * 0.25).map(r => `${r.a}${r.s >= 0 ? '+' : '-'}`).join(' ') || '-';
    const sign = dom.s >= 0 ? '+' : '-';
    console.log(`${String(i + 1).padStart(2)}  ${String(((b.end - b.start) / 1000).toFixed(2)).padStart(6)}s  ${String(b.count).padStart(7)}  ${dom.a.padEnd(8)}  ${sign}     ${b.peaks[dom.a].toFixed(2).padStart(5)}   ${secondary.padEnd(20)} ${GESTURES[i] ?? ''}`);
});

if (presses.length) {
    console.log('\nbutton presses (in order):');
    presses.forEach((p, i) => console.log(`${String(i + 1).padStart(2)}  bit ${String(p.bit).padStart(2)}  ${p.name}`));
}
