// [custom] Regression check for the eyedropper colour selection (M4): the
// sample pick returns the splat's display colour, the three metrics separate
// the fixture's clusters as expected, several samples combine, the op is
// honoured and the depth plane still gates both the pick and the kernel.
//
// Fixture: test/fixtures/color-clusters.ply - 4 clusters x 2000 splats:
// red (0.9,0.1,0.1) at (-1.5,0,0), green (0.1,0.8,0.2) at (1.5,0,0),
// blue (0.2,0.3,0.9) at (0,1.5,0), yellow (0.9,0.8,0.1) at (0,-1.5,0).
// The camera is parked at (0,0,6) looking at the origin (cluster depth 6 ± 0.4).
//
// usage: node scripts/desktop-start.mjs --remote-debugging-port=9222 --log-file=D:\tmp\m4.log test/fixtures/color-clusters.ply
//        node scripts/wait-renderer.mjs D:\tmp\m4.log
//        node scripts/check-color-selection.mjs [--port 9222]

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

// normalized screen point of a fixture (splat-local) position under the
// current camera. The splat entity carries the upright rotation SuperSplat
// applies to Y-down PLY data (180 degrees about Z), so local != world.
const screenPoint = (x, y, z) => evaluate(`(() => {
    const V = window.scene.camera.focalPoint.constructor;
    const splat = window.scene.events.invoke('selection');
    const world = splat.entity.getWorldTransform().transformPoint(new V(${x}, ${y}, ${z}));
    const s = new V();
    window.scene.camera.worldToScreen(world, s);
    return { x: s.x, y: s.y };
})()`);

const failures = [];
const expect = (label, actual, expected) => {
    const ok = actual === expected;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
    if (!ok) failures.push(label);
};
const near = (a, b, eps) => Array.isArray(a) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

// the fixture must be loaded and be the edit target
const state = await splatState();
if (!state || state.count !== 8000) {
    console.error(`FAIL expected the color-clusters fixture (8000 splats), got ${JSON.stringify(state)}`);
    process.exit(1);
}
if (!await evaluate(`!!window.scene.events.invoke('selection')`)) {
    console.error('FAIL no splat selected as the edit target');
    process.exit(1);
}

// park the camera: (0,0,6) -> origin, no damping. The fov is a persisted
// preference; the region checks are calibrated at 85 (a profile left at 90 by
// another probe put the edge stroke into the void, 2026-09-07), so pin it and
// restore the stored value at the end
const storedFov = await evaluate('window.scene.camera.fov');
await fire('camera.setFov', 85);
await evaluate(`(() => {
    const V = window.scene.camera.focalPoint.constructor;
    window.scene.camera.setPose(new V(0, 0, 6), new V(0, 0, 0), 0);
})()`);
await fire('selection.setUseDepth', false);
await fire('select.none');
await sleep(300);

const clusters = {
    red: { at: [-1.5, 0, 0], color: [0.9, 0.1, 0.1] },
    green: { at: [1.5, 0, 0], color: [0.1, 0.8, 0.2] },
    blue: { at: [0, 1.5, 0], color: [0.2, 0.3, 0.9] },
    yellow: { at: [0, -1.5, 0], color: [0.9, 0.8, 0.1] }
};

// sample: the rendered colour at the cluster centre (a 2D eyedropper; soft
// gaussian edges over the black background make it a little darker than the
// stored colour, so the check is "nearest cluster", not exact)
const nearest = (rgb) => Object.entries(clusters).sort((a, b) => dist(rgb, a[1].color) - dist(rgb, b[1].color))[0][0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const samples = {};
const points = {};
for (const [name, { at, color }] of Object.entries(clusters)) {
    const point = await screenPoint(...at);
    points[name] = point;
    samples[name] = await invoke('select.colorSample', point);
    expect(`sample ${name} at (${point.x.toFixed(3)}, ${point.y.toFixed(3)}) reads ${JSON.stringify(color)} +- 0.12`, near(samples[name], color, 0.12), true);
    expect(`sample ${name} is nearest to its own cluster`, samples[name] ? nearest(samples[name]) : null, name);
}
expect('sampling the void yields null', await invoke('select.colorSample', { x: 0.5, y: 0.5 }), null);

// a stroke from the red cluster to the green one yields two references
const strokePoints = Array.from({ length: 25 }, (_, i) => ({
    x: points.red.x + (points.green.x - points.red.x) * i / 24,
    y: points.red.y + (points.green.y - points.red.y) * i / 24
}));
const strokeColors = await invoke('select.colorSampleRegion', strokePoints, 16);
expect('stroke red -> green: two colour clusters', strokeColors.length, 2);
expect('stroke clusters are red and green', strokeColors.map(nearest).sort().join(','), 'green,red');

// the kernel checks use the exact cluster colours as references (the sampled
// pixels are slightly darker and would shift the per-channel rgb thresholds)
const ref = Object.fromEntries(Object.entries(clusters).map(([name, c]) => [name, c.color]));

// the event resolves to the SelectOp, which CDP cannot serialize: await it in-page
const match = async (op, refs, params) => {
    await evaluate(`window.scene.events.invoke('select.colorMatch', ${JSON.stringify(op)}, ${JSON.stringify(refs)}, ${JSON.stringify(params)}).then(op => op !== null)`, true);
    await sleep(100);
    return (await splatState()).selected;
};

// region limit: a tolerance that matches everything, limited to a stroke around
// the red cluster's centre, selects only the red cluster. The region test is
// always the footprint one (ellipse touches the stroke), whatever the toggle says
const redRegion = { strokes: [[{ x: points.red.x - 0.03, y: points.red.y }, { x: points.red.x + 0.03, y: points.red.y }]], radius: 0.05 };
expect('oklab 1 limited to a stroke over red: red cluster only', await match('set', [ref.red], { metric: 'oklab', tolerance: 1, region: redRegion }), 2000);
await fire('selection.setFootprint', 1);
expect('same with the footprint toggle on: red cluster only', await match('set', [ref.red], { metric: 'oklab', tolerance: 1, region: redRegion }), 2000);
await fire('selection.setFootprint', 0);
// a stroke touching only the red cluster's edge still reaches splats whose centre is off the stroke
const edgeRegion = { strokes: [[{ x: points.red.x - 0.05, y: points.red.y - 0.02 }, { x: points.red.x - 0.05, y: points.red.y + 0.02 }]], radius: 0.004 };
const edgeCount = await match('set', [ref.red], { metric: 'oklab', tolerance: 1, region: edgeRegion });
expect('a thin stroke at the red cluster edge selects some red splats by footprint', edgeCount > 0 && edgeCount < 2000, true);

// magic wand: a click floods the clicked cluster on screen and selects its
// splats; the clusters are separated by void, so even tolerance 1 stays within
// the clicked cluster while the non-contiguous wand at 1 takes everything
const wand = async (op, seeds, params) => {
    await evaluate(`window.scene.events.invoke('select.colorWand', ${JSON.stringify(op)}, ${JSON.stringify(seeds)}, ${JSON.stringify(params)}).then(r => r !== null)`, true);
    await sleep(100);
    return (await splatState()).selected;
};
expect('wand on red, tolerance 0.1: red cluster', await wand('set', [points.red], { metric: 'oklab', tolerance: 0.1, contiguous: true }), 2000);
expect('wand on red, tolerance 1, contiguous: still red only', await wand('set', [points.red], { metric: 'oklab', tolerance: 1, contiguous: true }), 2000);
expect('wand on red + blue: two clusters', await wand('set', [points.red, points.blue], { metric: 'oklab', tolerance: 0.1, contiguous: true }), 4000);
expect('wand not contiguous, tolerance 1: everything', await wand('set', [points.red], { metric: 'oklab', tolerance: 1, contiguous: false }), 8000);
expect('wand in the void: nothing changes', await wand('set', [{ x: 0.5, y: 0.5 }], { metric: 'oklab', tolerance: 0.1, contiguous: true }), 8000);
await fire('select.none');
await sleep(150);

// metrics: one cluster per sample at the default tolerance
expect('oklab 0.1, red sample: red cluster', await match('set', [ref.red], { metric: 'oklab', tolerance: 0.1 }), 2000);
expect('hsv 0.15, red sample: red cluster (yellow is 60 degrees away)', await match('set', [ref.red], { metric: 'hsv', tolerance: 0.15 }), 2000);
expect('rgb 0.05, red sample: red cluster', await match('set', [ref.red], { metric: 'rgb', tolerance: 0.05 }), 2000);
// rgb per channel cannot separate red from yellow at 0.72 (they share R 0.9,
// G differs by 0.7) while blue (B differs by 0.8) stays out
expect('rgb 0.72, red sample: red + yellow', await match('set', [ref.red], { metric: 'rgb', tolerance: 0.72 }), 4000);
expect('oklab 1, red sample: everything', await match('set', [ref.red], { metric: 'oklab', tolerance: 1 }), 8000);

// several samples combine (any reference within tolerance)
expect('oklab 0.1, red + blue samples: two clusters', await match('set', [ref.red, ref.blue], { metric: 'oklab', tolerance: 0.1 }), 4000);
expect('oklab 0.1, all four samples: everything', await match('set', Object.values(ref), { metric: 'oklab', tolerance: 0.1 }), 8000);

// ops against an existing selection
await fire('select.all');
await sleep(100);
expect('remove red from all: three clusters', await match('remove', [ref.red], { metric: 'oklab', tolerance: 0.1 }), 6000);
expect('intersect with green: green cluster', await match('intersect', [ref.green], { metric: 'oklab', tolerance: 0.1 }), 2000);
expect('add yellow: green + yellow', await match('add', [ref.yellow], { metric: 'oklab', tolerance: 0.1 }), 4000);

// the preview contract: the op returned is the top of the history, and undo removes it
await fire('select.none');
await sleep(100);
const isTop = await evaluate(`(async () => {
    const op = await window.scene.events.invoke('select.colorMatch', 'set', [${JSON.stringify(ref.red)}], { metric: 'oklab', tolerance: 0.1 });
    return op !== null && window.scene.events.invoke('edit.top') === op;
})()`, true);
expect('select.colorMatch resolves to the history top', isTop, true);
await fire('edit.undo');
await sleep(150);
expect('undo of the preview op clears it', (await splatState()).selected, 0);

// depth plane: the pick and the kernel are gated. The far plane is one of two
// gates under the depth toggle and is opt-in (occlusion, upstream's per-pixel
// pick, is the default), so enable it explicitly - the toggle alone is no
// longer enough. Occlusion off: these checks are about the plane.
await fire('selection.setUseDepth', true);
await fire('selection.setOcclusion', false);
await fire('selection.setDepthPlane', true);
await fire('selection.setDepthFar', 3);
const redPoint = await screenPoint(...clusters.red.at);
expect('far 3: sampling render leaves out splats beyond the plane', await invoke('select.colorSample', redPoint), null);
expect('far 3: kernel gated', await match('set', [ref.red], { metric: 'oklab', tolerance: 0.1 }), 0);
await fire('selection.setDepthFar', 7);
expect('far 7: red cluster again', await match('set', [ref.red], { metric: 'oklab', tolerance: 0.1 }), 2000);

// restore, including the gate defaults (occlusion on, far plane off)
await fire('selection.setDepthFar', 0);
await fire('selection.setUseDepth', false);
await fire('selection.setOcclusion', true);
await fire('selection.setDepthPlane', false);
await fire('select.none');
await fire('camera.reset');
await fire('camera.setFov', storedFov);
ws.close();

if (failures.length) {
    console.error(`FAIL ${failures.length} check(s): ${failures.join('; ')}`);
    process.exit(1);
}
console.log('PASS eyedropper colour selection');
