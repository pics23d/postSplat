// [custom] Regression check for the Skybox layer (user CR 2026-09-12): an
// equirectangular image imported as a scene-manager layer that renders behind
// the splats, is ignored by every splat path (publish / export enumerate
// `scene.splats`), stays out of the eyedropper's clean sampling render and of
// transparent exports, and travels with the .ssproj document.
//
// Fixture: test/fixtures/two-planes.ply + test/fixtures/skybox-test.png (one
// flat colour per direction, see scripts/make-fixtures.mjs). The camera is
// parked at the origin looking along each axis; the centre pixel of a small
// offscreen render must be that direction's colour.
//
// usage: node scripts/desktop-start.mjs --remote-debugging-port=9223 --user-data-dir=<fresh> --log-file=<log> --test-dir=<dir> test/fixtures/two-planes.ply test/fixtures/skybox-test.png
//        node scripts/wait-renderer.mjs <log>
//        node scripts/check-skybox.mjs --test-dir <dir> [--port 9223]

import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const port = Number(arg('--port', 9222));
const testDirArg = arg('--test-dir', null);
if (!testDirArg) {
    console.error('usage: node scripts/check-skybox.mjs --test-dir <dir> [--port 9222]');
    process.exit(2);
}
const testDir = path.resolve(testDirArg);

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

const waitFor = async (fn, timeoutMs = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const value = await fn();
        if (value) return value;
        await sleep(100);
    }
    return false;
};

let failures = 0;
let checks = 0;
const expect = (label, actual, expected) => {
    checks++;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const near = (a, b, eps) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const expectNear = (label, actual, expected, eps = 4) => {
    checks++;
    const ok = near(actual, expected, eps);
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ~${JSON.stringify(expected)})`}`);
};

// ---- state probes ----
const skyboxState = () => evaluate(`(() => {
    const s = window.scene.skybox;
    return s ? { name: s.name, visible: s.visible, width: s.texture.width, height: s.texture.height, bytes: s.bytes.length, filename: s.filename } : null;
})()`);
const rows = () => evaluate(`[...document.querySelectorAll('#scene-panel .splat-item')].map(r => ({
    text: r.querySelector('.splat-item-text').textContent,
    skybox: r.classList.contains('skybox'),
    visible: r.classList.contains('visible')
}))`);
// centre pixel of a small offscreen render: [r, g, b, a]
const centrePixel = (clean = false) => evaluate(`(async () => {
    const w = 64, h = 32;
    const data = await window.scene.events.invoke('render.offscreen', w, h, ${clean});
    const i = ((h >> 1) * w + (w >> 1)) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
})()`, true);
const lookAlong = async (dir) => {
    await evaluate(`(() => {
        const c = window.scene.camera;
        const V = c.focalPoint.constructor;
        c.setPose(new V(0, 0, 0), new V(${dir.join(', ')}), 0);
    })()`);
    await sleep(250);
};

// ---- 1. the import produced one skybox layer and one row ----
console.log('# skybox layer');
const initial = await waitFor(skyboxState);
expect('skybox element present', !!initial, true);
expect('texture size', [initial?.width, initial?.height], [512, 256]);
expect('name = filename', initial?.name, 'skybox-test.png');
expect('bytes kept verbatim', initial?.bytes, fs.statSync('test/fixtures/skybox-test.png').size);
const initialRows = await rows();
expect('two rows: the splat layer and the skybox', initialRows.length, 2);
expect('skybox row is last, flagged, visible', initialRows[1], { text: 'skybox-test.png', skybox: true, visible: true });
expect('splat row is a plain row', initialRows[0].skybox, false);
expect('selection is the splat, never the skybox', await evaluate(`window.scene.events.invoke('selection')?.type`), 'splat');

// ---- 2. splat paths ignore it ----
console.log('# splat paths');
expect('scene.splats (export / publish input) sees one layer', await evaluate(`window.scene.events.invoke('scene.splats').length`), 1);
expect('scene.allSplats (document layers) sees one layer', await evaluate(`window.scene.events.invoke('scene.allSplats').length`), 1);
expect('scene.empty is false (the splat counts, the skybox never would)', await invoke('scene.empty'), false);

// ---- 3. the dome renders behind the scene in the engine's mapping ----
console.log('# render');
await evaluate(`window.scene.events.invoke('scene.allSplats')[0].visible = false`);
await fire('camera.setTonemapping', 'linear');
const directions = [
    ['+x', [1, 0, 0], [255, 0, 0]],
    ['-x', [-1, 0, 0], [255, 255, 0]],
    ['+z', [0, 0, 1], [255, 0, 255]],
    ['-z', [0, 0, -1], [0, 255, 255]],
    ['up', [0, 1, 0.0001], [0, 0, 255]],
    ['down', [0, -1, 0.0001], [0, 255, 0]]
];
for (const [label, dir, color] of directions) {
    await lookAlong(dir);
    expectNear(`looking ${label}`, await centrePixel(), [...color, 255]);
}
await lookAlong([1, 0, 0]);
await evaluate('window.scene.camera.ortho = true');
await sleep(200);
expectNear('orthographic view still shows the dome', await centrePixel(), [255, 0, 0, 255]);
await evaluate('window.scene.camera.ortho = false');
await sleep(200);

// the eyedropper's sampling render and transparent exports never see it
expectNear('clean (sampling) render is transparent', await centrePixel(true), [0, 0, 0, 0], 0);
// the flag the transparent-background image / video exports switch off
expect('renderSkybox restored after an offscreen render', await evaluate('window.scene.camera.renderSkybox'), true);
expectNear('renderSkybox off = the dome is skipped', await evaluate(`(async () => {
    window.scene.camera.renderSkybox = false;
    window.scene.forceRender = true;
    await new Promise(r => window.scene.events.on('postrender', r));
    const { mainTarget, workTarget } = window.scene.camera;
    window.scene.dataProcessor.copyRt(mainTarget, workTarget);
    const data = new Uint8Array(4);
    await workTarget.colorBuffer.read(0, 0, 1, 1, { renderTarget: workTarget, data, immediate: true });
    window.scene.camera.renderSkybox = true;
    window.scene.forceRender = true;
    return [data[0], data[1], data[2], data[3]];
})()`, true), [0, 0, 0, 0], 0);

// ---- 4. row <-> element sync ----
console.log('# row sync');
await evaluate('window.scene.skybox.visible = false');
await sleep(100);
expect('row follows element visibility', (await rows())[1].visible, false);
expectNear('hidden skybox = transparent', await centrePixel(), [0, 0, 0, 0], 0);
await evaluate('window.scene.skybox.visible = true');
await sleep(100);
expect('row visible again', (await rows())[1].visible, true);
await evaluate(`window.scene.skybox.name = 'dome'`);
await sleep(100);
expect('row follows element name', (await rows())[1].text, 'dome');
// the row's eye toggles the element
await evaluate(`document.querySelectorAll('#scene-panel .splat-item')[1].querySelector('.splat-item-visible').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await sleep(100);
expect('row eye click hides the element', (await skyboxState()).visible, false);
expect('tonemapping restored default', await invoke('camera.tonemapping'), 'linear');

// ---- 5. document round trip ----
console.log('# document');
await evaluate(`window.scene.events.invoke('scene.allSplats')[0].visible = true`);
await invoke('doc.saveAs');
const ssproj = path.join(testDir, 'scene.ssproj');
expect('document written', await waitFor(() => fs.existsSync(ssproj) && fs.statSync(ssproj).size > 0), true);
const archive = fs.readFileSync(ssproj);
expect('archive carries skybox.png', archive.includes(Buffer.from('skybox.png', 'latin1')), true);
expect('archive carries the fixture bytes verbatim', archive.includes(fs.readFileSync('test/fixtures/skybox-test.png').subarray(0, 64)), true);

await fire('scene.clear');
await sleep(200);
expect('scene.clear removes the skybox', await skyboxState(), null);
expect('no rows after clear', (await rows()).length, 0);
await invoke('doc.openRecent', { kind: 'file', name: 'scene.ssproj', path: ssproj });
const reloaded = await waitFor(skyboxState);
expect('document reload restores the skybox', !!reloaded, true);
expect('restored name', reloaded?.name, 'dome');
expect('restored visibility (hidden when saved)', reloaded?.visible, false);
expect('restored bytes', reloaded?.bytes, fs.statSync('test/fixtures/skybox-test.png').size);
expect('restored filename / extension', reloaded?.filename, 'skybox-test.png');
const reloadedRows = await rows();
expect('rows after reload: splat + skybox (last)', reloadedRows.map(r => r.skybox), [false, true]);
expect('reloaded splat count', await evaluate(`window.scene.events.invoke('scene.splats')[0].numSplats`), 8192);

// ---- 6. replace and remove ----
console.log('# replace / remove');
const loadUrls = await evaluate(`new URL(location.href).searchParams.getAll('load')`);
const pngUrl = loadUrls.find(u => u.toLowerCase().endsWith('.png'));
expect('fixture url known to the page', !!pngUrl, true);
await invoke('import', [{ filename: 'skybox-test.png', url: pngUrl }]);
await sleep(200);
expect('a second import replaces the skybox (one element)', await evaluate(`window.scene.elements.filter(e => e.type === 'skybox').length`), 1);
expect('replacement is visible and renamed back', [(await skyboxState()).visible, (await skyboxState()).name], [true, 'skybox-test.png']);
expect('still one skybox row', (await rows()).filter(r => r.skybox).length, 1);
await evaluate('window.scene.skybox.destroy()');
await sleep(100);
expect('destroy removes the element', await skyboxState(), null);
expect('destroy removes the row', (await rows()).filter(r => r.skybox).length, 0);
expect('splat layer untouched by skybox removal', await evaluate(`window.scene.events.invoke('scene.splats').length`), 1);

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures}/${checks} checks passed`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
