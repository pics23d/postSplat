// [custom] Regression check for the Scene Manager layer merge (user CR
// 2026-09-11): two or more marked layers become one new layer with the world
// transforms baked, the selected / hidden flags carried over, the highest SH
// band count kept, the sources removed (undoable).
//
// Fixture: test/fixtures/two-planes.ply loaded TWICE (8192 splats each). An
// optional third layer with SH bands (e.g. _input/just-tree.ply) extends the
// band check.
//
// usage: node scripts/desktop-start.mjs --remote-debugging-port=9223 --user-data-dir=<fresh> --log-file=<log> test/fixtures/two-planes.ply test/fixtures/two-planes.ply [_input/just-tree.ply]
//        node scripts/wait-renderer.mjs <log>
//        node scripts/check-merge.mjs [--port 9223]

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

// every layer, in scene order
const layers = () => evaluate(`(() => {
    const out = [];
    window.scene.forEachElement(e => {
        if (e.type === 'splat') {
            const b = e.worldBound;
            const p = e.entity.getLocalPosition();
            out.push({
                name: e.name, count: e.instances.count, selected: e.instances.numSelected, hidden: e.instances.numHidden,
                bands: e.resource.shBands, uid: e.uid,
                position: [p.x, p.y, p.z].map(v => +v.toFixed(3)),
                min: [b.center.x - b.halfExtents.x, b.center.y - b.halfExtents.y, b.center.z - b.halfExtents.z].map(v => +v.toFixed(3)),
                max: [b.center.x + b.halfExtents.x, b.center.y + b.halfExtents.y, b.center.z + b.halfExtents.z].map(v => +v.toFixed(3))
            });
        }
    });
    return out;
})()`);
const selectionUid = () => evaluate('window.scene.events.invoke(\'selection\')?.uid ?? null');
const markedUids = () => evaluate('window.scene.events.invoke(\'scene.markedSplats\').map(s => s.uid)');
const withLayers = (body, ...indices) => evaluate(`(() => {
    const all = [];
    window.scene.forEachElement(e => { if (e.type === 'splat') all.push(e); });
    const L = ${JSON.stringify(indices)}.map(i => all[i]);
    ${body}
})()`);
const selectLayer = index => withLayers('window.scene.events.fire(\'selection\', L[0]);', index);
const markLayers = (...indices) => withLayers('window.scene.events.fire(\'scene.markSplats\', L);', ...indices);
const moveLayer = (index, x, y, z) => withLayers(`const V = window.scene.camera.focalPoint.constructor; L[0].move(new V(${x}, ${y}, ${z}));`, index);
const rowRect = index => evaluate(`(() => {
    const row = document.querySelectorAll('.splat-list .splat-item')[${index}];
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.5, marked: row.classList.contains('marked') };
})()`);
const mergeButtonEnabled = () => evaluate('!document.querySelector(\'#scene-panel .panel-header-button:nth-child(4)\').classList.contains(\'disabled\')');

// a real click on a row; modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8
const clickAt = async ({ x, y }, modifiers = 0) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers });
    await sleep(150);
};

const failures = [];
const expect = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
    if (!ok) failures.push(label);
};
const near = (label, actual, expected, eps = 0.01) => {
    const ok = actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) <= eps);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)} ± ${eps})`);
    if (!ok) failures.push(label);
};

let all = await layers();
// the two plane layers may sit anywhere in the list (an earlier undo re-adds
// layers at the end); the first other layer, if any, joins the band check
const planes = all.map((l, i) => (l.count === 8192 ? i : -1)).filter(i => i >= 0);
if (planes.length < 2) {
    console.error(`FAIL expected the two-planes fixture twice, got ${JSON.stringify(all.map(l => l.count))}`);
    process.exit(1);
}
const [ia, ib] = planes;
const initialCount = all.length;
const extra = all.find(l => l.count !== 8192) ?? null;
if (extra) console.log(`note: extra layer '${extra.name}' (${extra.count} splats, ${extra.bands} SH bands) joins the band check`);

// --- prepare: A fully selected, B moved by +5 z and fully hidden -------------
// (an aborted earlier run may have left flags behind: clear both planes first)
for (const index of [ia, ib]) {
    await selectLayer(index);
    await fire('select.unhide');
    await fire('select.none');
    await moveLayer(index, 0, 0, 0);
}
await sleep(200);
await selectLayer(ia);
await fire('select.all');
await sleep(150);
await moveLayer(ib, 0, 0, 5);
await selectLayer(ib);
await fire('select.all');
await sleep(100);
await fire('select.hide');
await sleep(200);
all = await layers();
expect('A selected before merge', all[ia].selected, 8192);
expect('B hidden before merge', all[ib].hidden, 8192);
expect('B position before merge', all[ib].position, [0, 0, 5]);
const unionMin = all[ia].min.map((v, i) => Math.min(v, all[ib].min[i]));
const unionMax = all[ia].max.map((v, i) => Math.max(v, all[ib].max[i]));

// --- real Ctrl / Shift clicks mark rows -----------------------------------
await clickAt(await rowRect(ia));
expect('plain click marks that row alone', (await markedUids()).length, 1);
expect('merge button disabled with one mark', await mergeButtonEnabled(), false);
await clickAt(await rowRect(ib), 2);
expect('ctrl+click adds the second row', (await markedUids()).length, 2);
expect('merge button enabled with two marks', await mergeButtonEnabled(), true);
await clickAt(await rowRect(ia), 2);
expect('ctrl+click again unmarks', (await markedUids()).length, 1);
// a selection made without a mark (programmatic) counts as marked on the first ctrl+click
await fire('scene.markSplats', []);
await selectLayer(ia);
await clickAt(await rowRect(ib), 2);
expect('ctrl+click adopts the current selection', (await markedUids()).length, 2);
// shift+click from the anchor (B, the last ctrl-click) to the last row, on top
// of the still-marked A
const last = all.length - 1;
const rangeMarks = new Set([ia]);
for (let i = Math.min(ib, last); i <= Math.max(ib, last); ++i) rangeMarks.add(i);
await clickAt(await rowRect(last), 8);
expect('shift+click marks the range', (await markedUids()).length, rangeMarks.size);
expect('marked rows carry the class', (await rowRect(ib)).marked, true);
await clickAt(await rowRect(ia));
expect('plain click leaves one mark', (await markedUids()).length, 1);
expect('row class cleared on the other row', (await rowRect(ib)).marked, false);

// --- merge A + B ------------------------------------------------------------
const uidA = all[ia].uid;
const uidB = all[ib].uid;
await markLayers(ia, ib);
expect('markSplats marks A and B', (await markedUids()).length, 2);
await fire('edit.merge');
for (let i = 0; i < 100; i++) {
    await sleep(200);
    all = await layers();
    if (all.length === initialCount - 1) break;
}
expect('layer count after merge', all.length, initialCount - 1);
const merged = all.find(l => l.uid !== uidA && l.uid !== uidB && !(extra && l.uid === extra.uid));
expect('merged layer exists', !!merged, true);
if (merged) {
    expect('merged name', merged.name, 'two-planes+1');
    expect('merged count', merged.count, 16384);
    expect('merged selected (A carried)', merged.selected, 8192);
    expect('merged hidden (B carried)', merged.hidden, 8192);
    expect('merged bands', merged.bands, 0);
    expect('merged sits at identity', merged.position, [0, 0, 0]);
    near('merged bound min = union of sources', merged.min, unionMin, 0.05);
    near('merged bound max = union of sources', merged.max, unionMax, 0.05);
    expect('merged is the edit target', await selectionUid(), merged.uid);
    expect('marks cleared after merge', (await markedUids()).length, 0);
}

// --- undo / redo --------------------------------------------------------------
await fire('edit.undo');
await sleep(600);
all = await layers();
expect('undo restores the layer count', all.length, initialCount);
expect('undo restores A', !!all.find(l => l.uid === uidA && l.count === 8192 && l.selected === 8192), true);
expect('undo restores B moved', all.find(l => l.uid === uidB)?.position, [0, 0, 5]);
expect('undo removes the merged layer', !!all.find(l => l.name === 'two-planes+1'), false);
await fire('edit.redo');
await sleep(600);
all = await layers();
expect('redo merges again', all.length, initialCount - 1);
expect('redo restores the merged layer', all.find(l => l.name === 'two-planes+1')?.count, 16384);

// --- SH bands: merge the merged planes with the extra layer, if any -----------
if (extra) {
    // note: undo re-adds restored layers at the end of the list, so list order
    // (and with it the merged name) may differ from the load order by now
    const mergedIndex = all.findIndex(l => l.name === 'two-planes+1');
    const extraIndex = all.findIndex(l => l.uid === extra.uid);
    const before = all.map(l => l.uid);
    await markLayers(mergedIndex, extraIndex);
    await fire('edit.merge');
    for (let i = 0; i < 100; i++) {
        await sleep(200);
        all = await layers();
        if (all.length === initialCount - 2) break;
    }
    const second = all.find(l => !before.includes(l.uid));
    expect('band merge count', second?.count, 16384 + extra.count);
    expect('band merge keeps the highest band count', second?.bands, extra.bands);
    expect('band merge name follows the first marked row', /\+1$/.test(second?.name ?? ''), true);
    await fire('edit.undo');
    await sleep(600);
}

// --- restore: sources back, nothing selected ----------------------------------
await fire('edit.undo');
await sleep(600);
all = await layers();
expect('final layer count', all.length, initialCount);
const finalA = all.findIndex(l => l.uid === uidA);
const finalB = all.findIndex(l => l.uid === uidB);
await selectLayer(finalA);
await fire('select.none');
await moveLayer(finalB, 0, 0, 0);
await selectLayer(finalB);
await fire('select.unhide');
await sleep(200);

ws.close();
if (failures.length) {
    console.log(`\nFAIL ${failures.length} check(s): ${failures.join(', ')}`);
    process.exit(1);
}
console.log('\nPASS');
