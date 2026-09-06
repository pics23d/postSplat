// [custom] Regression check for the desktop file dialogs (user CR 2026-09-06):
// Save and Export default to the directory they last used, and before that to
// the directory of the last opened file; writes stream through the shell into
// the chosen path; recent files reopen by path.
//
// The app must run with the dialogs bypassed and a fresh user-data dir:
//   node scripts/desktop-start.mjs --remote-debugging-port=9222 --log-file=D:/tmp/files.log ^
//        --user-data-dir=D:/tmp/ss-run1/userdata --test-dir=D:/tmp/ss-run1/out test/fixtures/two-planes.ply
//   node scripts/wait-renderer.mjs D:/tmp/files.log
//   node scripts/check-desktop-files.mjs --log D:/tmp/files.log --test-dir D:/tmp/ss-run1/out [--port 9222]
//
// --test-dir makes every save dialog resolve to <dir>/<suggestedName> while
// still logging the default path the real dialog would have opened with; the
// check asserts those defaults from the log file.

import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const port = Number(arg('--port', 9222));
const logFile = arg('--log', null);
const testDirArg = arg('--test-dir', null);
if (!logFile || !testDirArg) {
    console.error('usage: node scripts/check-desktop-files.mjs --log <renderer log> --test-dir <dir> [--port 9222]');
    process.exit(2);
}
const testDir = path.resolve(testDirArg);
const fixtureDir = path.resolve('test', 'fixtures');

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.startsWith('app://'));
if (!page) {
    console.error('no app page target on port', port);
    process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});

let nextId = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const onMessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
            ws.removeEventListener('message', onMessage);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        }
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression, awaitPromise = false) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fire = (event, ...args) => evaluate(`window.scene.events.fire(${JSON.stringify(event)}, ${args.map(a => JSON.stringify(a)).join(', ')})`);
const invoke = (event, ...args) => evaluate(`window.scene.events.invoke(${JSON.stringify(event)}, ${args.map(a => JSON.stringify(a)).join(', ')})`, true);

const splatCount = () => evaluate(`(() => {
    let count = 0;
    window.scene.forEachElement(e => { if (e.type === 'splat') count += e.instances.count; });
    return count;
})()`);

const failures = [];
const expect = (label, actual, expected) => {
    const ok = actual === expected;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
    if (!ok) failures.push(label);
};

// dialog lines the shell logged, newest last
const dialogLines = () => fs.readFileSync(logFile, 'utf8').split('\n').filter(line => line.includes('[shell] file dialog'));
const lastDialog = () => dialogLines().at(-1) ?? '';
const defaultOf = line => /default=(.*?) -> /.exec(line)?.[1] ?? null;

const waitFor = async (predicate, timeoutMs = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await predicate()) return true;
        await sleep(200);
    }
    return false;
};

const ssproj = path.join(testDir, 'scene.ssproj');

if (await splatCount() !== 8192) {
    console.error('FAIL expected the two-planes fixture (8192 splats) loaded from the command line');
    process.exit(1);
}
expect('desktop bridge present', await evaluate('!!window.ssDesktop'), true);

// 1. first Save As: no save dir yet -> defaults to the fixture directory (last opened file)
const dialogsBefore = dialogLines().length;
await invoke('doc.saveAs');
expect('save as wrote scene.ssproj', await waitFor(() => fs.existsSync(ssproj) && fs.statSync(ssproj).size > 0), true);
await sleep(300);
expect('save as is a zip', fs.readFileSync(ssproj).subarray(0, 2).toString('latin1'), 'PK');
expect('no temp file left behind', fs.readdirSync(testDir).filter(f => f.endsWith('.part')).length, 0);
expect('first save default = fixture dir', defaultOf(lastDialog()), path.join(fixtureDir, 'scene.ssproj'));
expect('document name follows the saved file', await invoke('doc.name'), 'scene.ssproj');

// 2. second Save As: defaults to the last save directory
await invoke('doc.saveAs');
await sleep(500);
expect('second save default = last save dir', defaultOf(lastDialog()), path.join(testDir, 'scene.ssproj'));

// 3. plain Save rewrites the file without a dialog
const dialogsBeforeSave = dialogLines().length;
const mtimeBefore = fs.statSync(ssproj).mtimeMs;
await sleep(50);
await invoke('doc.save');
expect('save rewrote the file', await waitFor(() => fs.statSync(ssproj).mtimeMs > mtimeBefore), true);
expect('save opened no dialog', dialogLines().length, dialogsBeforeSave);

// 4. export: no export dir yet -> defaults to the fixture directory, not the save directory
const plyFiles = () => fs.readdirSync(testDir).filter(f => f.toLowerCase().endsWith('.ply'));
// newest ply write time in the test dir (the export keeps the same suggested name, so
// a second export overwrites rather than adds)
const newestPly = () => Math.max(0, ...plyFiles().map(f => fs.statSync(path.join(testDir, f)).mtimeMs));
const runExport = async () => {
    const before = newestPly();
    const done = invoke('scene.export', 'ply');
    // the export popup needs its Export button; press it in-page
    await waitFor(() => evaluate(`!!document.querySelector('#export-popup:not(.pcui-hidden) #footer .pcui-button')`), 5000);
    await evaluate(`[...document.querySelectorAll('#export-popup #footer .pcui-button')].at(-1).click()`);
    await done;
    return waitFor(() => newestPly() > before && plyFiles().every(f => fs.statSync(path.join(testDir, f)).size > 0));
};
expect('export wrote a ply', await runExport(), true);
await sleep(300);
const exported = plyFiles()[0];
expect('exported file has a ply header', fs.readFileSync(path.join(testDir, exported)).subarray(0, 3).toString('latin1'), 'ply');
expect('first export default = fixture dir', path.dirname(defaultOf(lastDialog()) ?? ''), fixtureDir);

// 5. second export: defaults to the last export directory
expect('second export wrote a ply', await runExport(), true);
await sleep(300);
expect('second export default = last export dir', path.dirname(defaultOf(lastDialog()) ?? ''), testDir);

// 6. recent files: a stored {path} record reopens through the shell
await fire('scene.clear');
await sleep(300);
expect('scene cleared', await splatCount(), 0);
await invoke('doc.openRecent', { kind: 'file', name: 'scene.ssproj', path: ssproj });
expect('recent document reloaded the splats', await waitFor(async () => (await splatCount()) === 8192), true);
expect('recent document name', await invoke('doc.name'), 'scene.ssproj');
// a path the shell never handed out is refused (doc.openRecent would show the
// upstream error popup, which blocks CDP, so probe the bridge directly)
expect('unknown recent path is refused', await evaluate(`window.ssDesktop.resolveRecent(${JSON.stringify(path.join(testDir, 'never-seen.ssproj'))})`, true), null);
expect('known recent path resolves', (await evaluate(`window.ssDesktop.resolveRecent(${JSON.stringify(ssproj)})`, true))?.filename ?? null, 'scene.ssproj');

console.log(`dialog lines this run: ${dialogLines().length - dialogsBefore}`);
ws.close();

if (failures.length) {
    console.error(`FAIL ${failures.length} check(s): ${failures.join('; ')}`);
    process.exit(1);
}
console.log('PASS desktop file dialogs');
