// [custom] Regression check for Hide Selected / Hide Unselected / Unhide All
// (user CR 2026-09-08, replaces upstream's Lock): hidden splats are culled from
// the draw and the pick, unselectable, protected from delete; unhide never
// re-selects; every op acts on the active layer only.
//
// Fixture: test/fixtures/two-planes.ply loaded TWICE (two layers) - front plane
// z=0 (red, 4096 splats), back plane z=-2 (blue, 4096). The camera is parked at
// (0,0,4) looking at the origin, so the planes sit at view depths 4 and 6.
//
// usage: node scripts/desktop-start.mjs --remote-debugging-port=9223 --user-data-dir=<fresh> --log-file=<log> test/fixtures/two-planes.ply test/fixtures/two-planes.ply
//        node scripts/wait-renderer.mjs <log>
//        node scripts/check-hide.mjs [--port 9223]

const port = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 9222;

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

// every layer's counts, in scene order
const layers = () => evaluate(`(() => {
    const out = [];
    window.scene.forEachElement(e => { if (e.type === 'splat') out.push({ count: e.instances.count, selected: e.instances.numSelected, hidden: e.instances.numHidden }); });
    return out;
})()`);

// the active layer's counts
const active = async () => {
    const [index, all] = await Promise.all([activeIndex(), layers()]);
    return all[index];
};
const activeIndex = () => evaluate(`(() => {
    const out = [];
    window.scene.forEachElement(e => { if (e.type === 'splat') out.push(e); });
    return out.indexOf(window.scene.events.invoke('selection'));
})()`);
const selectLayer = index => evaluate(`(() => {
    const out = [];
    window.scene.forEachElement(e => { if (e.type === 'splat') out.push(e); });
    window.scene.events.fire('selection', out[${index}]);
})()`);
const setLayerVisible = (index, visible) => evaluate(`(() => {
    const out = [];
    window.scene.forEachElement(e => { if (e.type === 'splat') out.push(e); });
    out[${index}].visible = ${visible};
})()`);

// mean rgb of the central 20% of an offscreen render (RGBA8)
const centerMean = () => evaluate(`(async () => {
    const w = 320, h = 180;
    const data = await window.scene.events.invoke('render.offscreen', w, h);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.floor(h * 0.4); y < Math.floor(h * 0.6); y++) {
        for (let x = Math.floor(w * 0.4); x < Math.floor(w * 0.6); x++) {
            const i = (y * w + x) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
    }
    return { r: r / n, g: g / n, b: b / n };
})()`, true);

// depth pick at the viewport centre: the frontmost drawn splat's distance
const pickDistance = () => evaluate('window.scene.camera.intersect(0.5, 0.5).then(r => r ? r.distance : null)', true);

// a real key press (keyDown + keyUp); modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8
const key = async (k, modifiers = 0) => {
    const base = { key: k, code: 'KeyH', windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72, modifiers };
    await call('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(200);
};

const failures = [];
const expect = (label, actual, expected) => {
    const ok = actual === expected;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
    if (!ok) failures.push(label);
};

// the fixture must be loaded (twice for the two-layer section)
let all = await layers();
if (!all.length || all[0].count !== 8192) {
    console.error(`FAIL expected the two-planes fixture (8192 splats), got ${JSON.stringify(all)}`);
    process.exit(1);
}
const twoLayers = all.length >= 2 && all[1].count === 8192;
if (!twoLayers) {
    console.log('note: second layer missing, the two-layer section is skipped');
}

// layer A is the edit target; B stays out of the picture until its section
await selectLayer(0);
if (twoLayers) await setLayerVisible(1, false);
await sleep(200);

// park the camera: (0,0,4) -> origin, no damping
await evaluate(`(() => {
    const V = window.scene.camera.focalPoint.constructor;
    window.scene.camera.setPose(new V(0, 0, 4), new V(0, 0, 0), 0);
})()`);
await sleep(300);

const fullRect = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
// the front plane = a full-viewport rect gated by the depth far plane at 5.
// The far plane is one of two gates under the depth toggle and is opt-in, so
// enable it explicitly and turn occlusion (upstream's per-pixel pick) off -
// that would select only the splats winning a pixel, not the whole plane.
const selectFront = async () => {
    await fire('selection.setUseDepth', true);
    await fire('selection.setOcclusion', false);
    await fire('selection.setDepthPlane', true);
    await fire('selection.setDepthFar', 5);
    await fire('selection.setFootprint', 0);
    await invoke('select.rect', 'set', fullRect);
    await fire('selection.setUseDepth', false);
    await fire('selection.setOcclusion', true);
    await fire('selection.setDepthPlane', false);
    await sleep(150);
    return (await active()).selected;
};
const step = async (event, ...args) => {
    await fire(event, ...args);
    await sleep(150);
    return active();
};

// 1. baseline
await fire('select.unhide');
await fire('select.none');
await sleep(150);
let a = await active();
expect('baseline hidden', a.hidden, 0);
expect('baseline selected', a.selected, 0);
const base = await centerMean();
expect('baseline centre is the red front plane', base.r > base.b, true);
const baseDistance = await pickDistance();
expect('baseline pick hits the front plane (depth 4)', Math.abs(baseDistance - 4) < 0.2, true);

// 2. hide selected: culled from draw + pick, unselectable, delete-protected
expect('front plane selected', await selectFront(), 4096);
a = await step('select.hide');
expect('hide selected: hidden', a.hidden, 4096);
expect('hide selected: selected cleared', a.selected, 0);
const hiddenMean = await centerMean();
expect('hidden front plane is culled from the draw (centre blue)', hiddenMean.b > hiddenMean.r, true);
const hiddenDistance = await pickDistance();
expect('hidden front plane is culled from the pick (depth 6)', Math.abs(hiddenDistance - 6) < 0.2, true);
a = await step('select.all');
expect('select all skips hidden', a.selected, 4096);
a = await step('select.delete');
expect('delete leaves the hidden splats', a.count, 4096);
expect('delete leaves them hidden', a.hidden, 4096);
await step('edit.undo');
a = await step('edit.undo');
expect('undo delete + select all', a.count === 8192 && a.selected === 0, true);

// 3. undo restores the exact bytes (selected again), redo re-hides
a = await step('edit.undo');
expect('undo hide: hidden', a.hidden, 0);
expect('undo hide: selection restored', a.selected, 4096);
a = await step('edit.redo');
expect('redo hide', a.hidden === 4096 && a.selected === 0, true);
a = await step('select.unhide');
expect('unhide after redo', a.hidden, 0);

// 4. hide unselected keeps the selection and the drawn front plane
expect('front plane selected again', await selectFront(), 4096);
a = await step('select.hideUnselected');
expect('hide unselected: hidden', a.hidden, 4096);
expect('hide unselected: selection kept', a.selected, 4096);
const keptMean = await centerMean();
expect('front plane still drawn (centre red)', keptMean.r > keptMean.b, true);
const keptDistance = await pickDistance();
expect('front plane still picks (depth 4)', Math.abs(keptDistance - 4) < 0.2, true);
await step('select.none');

// 5. unhide all: never re-selects; undo / redo
a = await step('select.unhide');
expect('unhide all: hidden', a.hidden, 0);
expect('unhide all: nothing selected', a.selected, 0);
a = await step('edit.undo');
expect('undo unhide', a.hidden, 4096);
a = await step('edit.redo');
expect('redo unhide', a.hidden, 0);

// 6. real keys: H / Shift+H / Alt+H
expect('front plane selected for the keys', await selectFront(), 4096);
await key('h');
a = await active();
expect('H hides the selection', a.hidden === 4096 && a.selected === 0, true);
await key('H', 8);
a = await active();
expect('Shift+H unhides, nothing selected', a.hidden === 0 && a.selected === 0, true);
expect('front plane selected for Alt+H', await selectFront(), 4096);
await key('h', 1);
a = await active();
expect('Alt+H hides the unselected, selection kept', a.hidden === 4096 && a.selected === 4096, true);
await key('H', 8);
a = await active();
// the front plane was never hidden, so it stays selected: unhide only frees
// the hidden splats and never touches the rest
expect('Shift+H after Alt+H unhides and keeps the untouched selection', a.hidden === 0 && a.selected === 4096, true);
await step('select.none');

// 7. two layers: every op stays on the active layer
if (twoLayers) {
    expect('layer A: front plane selected', await selectFront(), 4096);
    await step('select.hide');
    await setLayerVisible(1, true);
    await selectLayer(1);
    await sleep(200);
    expect('layer B is active', await activeIndex(), 1);
    await step('select.none');
    await step('select.hideUnselected');
    all = await layers();
    expect('B: hide unselected with no selection hides everything', all[1].hidden, 8192);
    expect('A untouched by B\'s hide', all[0].hidden, 4096);
    await step('select.unhide');
    all = await layers();
    expect('B: unhide all', all[1].hidden, 0);
    expect('A untouched by B\'s unhide', all[0].hidden, 4096);
    await selectLayer(0);
    await sleep(200);
    a = await step('select.unhide');
    expect('A: unhide all', a.hidden, 0);
    await setLayerVisible(1, false);
    await sleep(150);
}

// 8. status bar: the "Hidden" stat follows the active layer
expect('front plane selected for the status bar', await selectFront(), 4096);
await step('select.hide');
const status = await evaluate(`(() => {
    const values = [...document.querySelectorAll('.status-bar-stat-value')];
    return values.map(v => ({ label: v.previousElementSibling?.textContent ?? '', value: v.textContent }));
})()`);
const hiddenStat = status.find(s => s.label === 'Hidden');
expect('status bar has a Hidden stat', !!hiddenStat, true);
expect('status bar has no Locked stat', status.some(s => s.label === 'Locked'), false);
expect('Hidden stat shows the active layer\'s count', hiddenStat?.value.replace(/[^0-9]/g, ''), '4096');

// restore
await fire('select.unhide');
await fire('select.none');
await fire('selection.setDepthFar', 0);
await fire('selection.setUseDepth', false);
if (twoLayers) await setLayerVisible(1, true);
await fire('camera.reset');
ws.close();

if (failures.length) {
    console.error(`FAIL ${failures.length} check(s): ${failures.join('; ')}`);
    process.exit(1);
}
console.log('PASS hide ops');
