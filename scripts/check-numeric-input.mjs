// [custom] Regression check: typing a number into a PCUI numeric field and pressing Enter
// must apply it. Uses REAL key events over CDP (Input.dispatchKeyEvent), because
// Runtime.evaluate lifts the CSP eval block that broke this in the first place
// (PCUI NumericInput evaluates typed text via Function(); see electron/protocol.ts).
//
// usage: node scripts/desktop-start.mjs --remote-debugging-port=9222 test/fixtures/color-clusters.ply
//        node scripts/check-numeric-input.mjs [--port 9222]

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

const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
};

const splatPosition = () => evaluate(`(() => {
    let pos = null;
    window.scene.forEachElement(e => { if (e.type === 'splat') { const p = e.entity.getLocalPosition(); pos = [p.x, p.y, p.z]; } });
    return pos;
})()`);

const typeKeys = async (text) => {
    for (const ch of text) {
        const code = ch === '.' ? 'Period' : ch === '-' ? 'Minus' : `Digit${ch}`;
        await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, unmodifiedText: ch });
        await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code });
    }
};

const pressEnter = async () => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};

await call('Page.bringToFront');

// Position X is the first input of the transform panel; the fixture layer must be selected
const ready = await evaluate(`(() => {
    const el = document.querySelector('#transform input');
    if (!el || el.offsetParent === null) return 'no transform input';
    if (el.disabled || el.readOnly) return 'transform input disabled (no splat selected?)';
    el.focus(); el.select();
    return document.activeElement === el ? 'ok' : 'focus failed';
})()`);
if (ready !== 'ok') {
    console.error(`FAIL ${ready}`);
    process.exit(1);
}

const before = await splatPosition();
const value = ((Math.round(Math.random() * 400) - 200) / 100).toFixed(2); // e.g. -1.23
await typeKeys(value);
await pressEnter();
await new Promise(r => setTimeout(r, 300));
const after = await splatPosition();
const field = await evaluate(`document.querySelector('#transform input').value`);

// restore
await evaluate(`window.scene.events.fire('camera.reset')`);

ws.close();

const expected = Number(value);
const ok = after && Math.abs(after[0] - expected) < 1e-3 && Math.abs(after[1] - before[1]) < 1e-6 && Math.abs(after[2] - before[2]) < 1e-6;
console.log(JSON.stringify({ typed: value, field, before, after }, null, 2));
if (!ok) {
    console.error(`FAIL typed ${value} but Position X became ${after?.[0]} (field shows "${field}")`);
    process.exit(1);
}
console.log('PASS numeric input Enter applies the typed value');
