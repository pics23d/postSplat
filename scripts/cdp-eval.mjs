// [custom] Evaluate a JavaScript expression inside the running desktop renderer
// over the Chrome DevTools Protocol. Headless assertion primitive for the
// round-trip harness — no clicking, no screenshots.
//
// Launch the app with remote debugging first:
//   node scripts/desktop-start.mjs --remote-debugging-port=9222 [file.ply]
// then:
//   node scripts/cdp-eval.mjs "window.scene.splats.length"
//   node scripts/cdp-eval.mjs --port 9222 "typeof window.showSaveFilePicker"
//   node scripts/cdp-eval.mjs --await "await window.ssDesktop.info()"
//
// Prints the JSON-serialized result (or the exception) and exits non-zero on failure.

import fs from 'node:fs';

const args = process.argv.slice(2);
let port = 9222;
let awaitPromise = false;
let focus = false;
let click = null;
let drag = null;
let typeText = null;
const keys = [];
let timeoutMs = 15000;

// a native modal dialog in the main process stalls CDP; never hang the harness on it
setTimeout(() => {
    console.error(`cdp-eval: timed out after ${timeoutMs} ms (main process blocked by a dialog?)`);
    process.exit(124);
}, timeoutMs).unref();
let screenshot = null;
const rest = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') {
        port = Number(args[++i]);
    } else if (args[i] === '--await') {
        awaitPromise = true;
    } else if (args[i] === '--focus') {
        // bring the window to front first (input controllers ignore an unfocused document)
        focus = true;
    } else if (args[i] === '--click') {
        // synthesize a left click at CSS pixel x,y first: grants user activation, which
        // Chromium requires before it honours beforeunload / prompts
        click = args[++i].split(',').map(Number);
    } else if (args[i] === '--drag') {
        // synthesize a left drag x1,y1,x2,y2 (css px): press, 24 moves, release
        drag = args[++i].split(',').map(Number);
    } else if (args[i] === '--file') {
        // read the expression from a file (multi-statement probes without quoting
        // trouble; semicolons in an inline argument trip the permission matcher)
        rest.push(fs.readFileSync(args[++i], 'utf8'));
    } else if (args[i] === '--screenshot') {
        // save the page as rendered (PNG) after evaluating — no focus change, unlike a
        // desktop capture, so it works while other windows cover the app
        screenshot = args[++i];
    } else if (args[i] === '--timeout') {
        timeoutMs = Number(args[++i]);
    } else if (args[i] === '--type') {
        // insert text into the focused element as real input (Input.insertText)
        typeText = args[++i];
    } else if (args[i] === '--key') {
        // press a key on the focused element, e.g. Enter, Tab, Escape (keyDown + keyUp)
        keys.push(args[++i]);
    } else {
        rest.push(args[i]);
    }
}
const expression = rest.join(' ');
if (!expression) {
    console.error('usage: node scripts/cdp-eval.mjs [--port 9222] [--await] "<expression>"');
    process.exit(2);
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.startsWith('app://'));
if (!page) {
    console.error(`no app:// page target on port ${port}; targets: ${targets.map(t => t.url).join(', ')}`);
    process.exit(3);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});

const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
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

if (focus) {
    await call('Page.bringToFront');
}

if (click) {
    const [x, y] = click;
    for (const type of ['mousePressed', 'mouseReleased']) {
        await call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
}

if (drag) {
    const [x1, y1, x2, y2] = drag;
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
    const steps = 24;
    for (let s = 1; s <= steps; s++) {
        await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * s / steps, y: y1 + (y2 - y1) * s / steps, button: 'left', buttons: 1 });
    }
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
}

if (typeText !== null) {
    await call('Input.insertText', { text: typeText });
}

const KEY_CODES = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40 };
for (const key of keys) {
    const base = { key, code: key, windowsVirtualKeyCode: KEY_CODES[key] ?? 0, nativeVirtualKeyCode: KEY_CODES[key] ?? 0 };
    await call('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

const wrapped = awaitPromise ? `(async () => { return ${expression}; })()` : expression;
const result = await call('Runtime.evaluate', {
    expression: wrapped,
    awaitPromise,
    returnByValue: true
});

if (screenshot) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
    console.error(`screenshot saved ${screenshot}`);
}

ws.close();

if (result.exceptionDetails) {
    console.error(JSON.stringify(result.exceptionDetails, null, 2));
    process.exit(1);
}
console.log(JSON.stringify(result.result.value ?? result.result, null, 2));
