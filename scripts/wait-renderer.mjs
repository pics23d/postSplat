// [custom] Wait until the desktop app's renderer has started (or failed), by watching the
// --log-file the shell writes. Replaces ad-hoc shell polling loops in the harness.
//
// usage: node scripts/wait-renderer.mjs <log-file> [--timeout 90] [--settle 2]
// exit 0 = "Powered by PlayCanvas" seen, 1 = failure line seen, 2 = timeout

import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : fallback;
};
const timeoutS = opt('--timeout', 90);
const settleS = opt('--settle', 2);

if (!file) {
    console.error('usage: node scripts/wait-renderer.mjs <log-file> [--timeout s] [--settle s]');
    process.exit(2);
}

const started = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (;;) {
    let text = '';
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        // not written yet
    }
    if (/did-fail-load|render-process-gone/.test(text)) {
        console.error(`renderer failed after ${((Date.now() - started) / 1000).toFixed(1)}s`);
        console.error(text.split('\n').filter(l => /fail|gone|error/i.test(l)).slice(-5).join('\n'));
        process.exit(1);
    }
    // the version banner is logged by both debug and release bundles; match the
    // version marker, not the product name, so a rebrand cannot break the harness
    // (the engine's "Powered by PlayCanvas" line only appears in debug builds)
    if (text.includes('did-finish-load') && /\w*[Ss]plat v\d/.test(text)) {
        await sleep(settleS * 1000);
        console.log(`renderer ready after ${((Date.now() - started) / 1000).toFixed(1)}s`);
        process.exit(0);
    }
    if (Date.now() - started > timeoutS * 1000) {
        console.error(`timeout after ${timeoutS}s waiting for ${file}`);
        process.exit(2);
    }
    await sleep(1000);
}
