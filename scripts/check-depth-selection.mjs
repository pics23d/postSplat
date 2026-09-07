// [custom] Regression check for the depth selection far plane (M3): with the
// depth toggle on, viewport selections must exclude splats beyond the plane,
// and the render must fade them.
//
// Fixture: test/fixtures/two-planes.ply - front plane z=0 (red, 4096 splats),
// back plane z=-2 (blue, 4096). The camera is parked at (0,0,4) looking at the
// origin, so the planes sit at view depths 4 and 6.
//
// usage: node scripts/desktop-start.mjs --remote-debugging-port=9222 --log-file=D:\tmp\m3.log test/fixtures/two-planes.ply
//        node scripts/wait-renderer.mjs D:\tmp\m3.log
//        node scripts/check-depth-selection.mjs [--port 9222]

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

const splatState = () => evaluate(`(() => {
    let state = null;
    window.scene.forEachElement(e => { if (e.type === 'splat') state = { count: e.instances.count, selected: e.instances.numSelected }; });
    return state;
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

const failures = [];
const expect = (label, actual, expected) => {
    const ok = actual === expected;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
    if (!ok) failures.push(label);
};

// the fixture must be loaded and be the edit target
let state = await splatState();
if (!state || state.count !== 8192) {
    console.error(`FAIL expected the two-planes fixture (8192 splats), got ${JSON.stringify(state)}`);
    process.exit(1);
}
if (!await evaluate(`!!window.scene.events.invoke('selection')`)) {
    console.error('FAIL no splat selected as the edit target');
    process.exit(1);
}

// park the camera: (0,0,4) -> origin, no damping. Vec3 comes from the camera's own focal point
await evaluate(`(() => {
    const V = window.scene.camera.focalPoint.constructor;
    window.scene.camera.setPose(new V(0, 0, 4), new V(0, 0, 0), 0);
})()`);
await sleep(300);

const fullRect = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
const rectSelect = async () => {
    await invoke('select.rect', 'set', fullRect);
    await sleep(150);
    return (await splatState()).selected;
};

// baseline: depth off, centers -> everything
await fire('selection.setUseDepth', false);
await fire('selection.setFootprint', 0);
expect('depth off, rect selects both planes', await rectSelect(), 8192);

// plane between the planes: only the front plane, in both footprint modes
await fire('selection.setUseDepth', true);
await fire('selection.setDepthFar', 5);
expect('far 5, centers: front plane only', await rectSelect(), 4096);
await fire('selection.setFootprint', 1);
expect('far 5, footprint: front plane only', await rectSelect(), 4096);
await fire('selection.setFootprint', 0);

// plane beyond both / in front of both
await fire('selection.setDepthFar', 7);
expect('far 7: both planes', await rectSelect(), 8192);
await fire('selection.setDepthFar', 3);
expect('far 3: nothing', await rectSelect(), 0);

// eyedropper (M4 api): the sample pick is gated (far 3 -> no sample), the
// match kernel is gated (rgb tolerance 1 matches every colour within the plane)
await fire('select.none');
expect('far 3, eyedropper at centre: sample pick gated', await invoke('select.colorSample', { x: 0.5, y: 0.5 }), null);
// the event resolves to the SelectOp, which CDP cannot serialize: await it in-page
const matchAny = () => evaluate(`window.scene.events.invoke('select.colorMatch', 'set', [[0.9, 0.2, 0.2]], { metric: 'rgb', tolerance: 1 }).then(op => op !== null)`, true);
await fire('selection.setDepthFar', 5);
await matchAny();
await sleep(150);
expect('far 5, eyedropper tolerance 1: front plane only', (await splatState()).selected, 4096);
await fire('selection.setDepthFar', 7);
await matchAny();
await sleep(150);
expect('far 7, eyedropper tolerance 1: both planes', (await splatState()).selected, 8192);

// unset plane = focal distance (4 here) and Alt+wheel stepping from it
await fire('select.none');
await fire('selection.setDepthFar', 0);
const effective = await invoke('selection.effectiveDepthFar');
expect('unset plane sits at the focal distance', Math.abs(effective - 4) < 0.05, true);
await fire('selection.stepDepthFar', -1);
const stepped = await invoke('selection.depthFar');
expect('one wheel notch up moves the plane 5% farther', Math.abs(stepped - 4 * 1.05) < 0.01, true);

// visual gate: with the plane at 3 the (red) front plane is beyond it and
// darkens (colour × fade, so density and opacity don't matter). Test at a known
// low fade and restore the user's
const userFade = await invoke('selection.depthFade');
await fire('selection.setDepthFar', 3);
await fire('selection.setDepthFade', 0.05);
const faded = await centerMean();
await fire('selection.setDepthFade', userFade);
const defaultFade = await centerMean();
await fire('selection.setUseDepth', false);
const normal = await centerMean();
console.log(`centre red: off ${normal.r.toFixed(1)}, far 3 at fade ${userFade} ${defaultFade.r.toFixed(1)}, at fade 0.05 ${faded.r.toFixed(1)}`);
expect('far 3 at fade 0.05 fades the front plane (centre red drops > 60%)', faded.r < normal.r * 0.4, true);
expect('the stored fade fades it too (centre red drops > 25%)', defaultFade.r < normal.r * 0.75, true);

// restore
await fire('selection.setDepthFar', 0);
await fire('selection.setUseDepth', false);
await fire('select.none');
await fire('camera.reset');
ws.close();

if (failures.length) {
    console.error(`FAIL ${failures.length} check(s): ${failures.join('; ')}`);
    process.exit(1);
}
console.log('PASS depth selection far plane');
