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

const args = process.argv.slice(2);
let port = 9222;
let awaitPromise = false;
let focus = false;
const rest = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') {
        port = Number(args[++i]);
    } else if (args[i] === '--await') {
        awaitPromise = true;
    } else if (args[i] === '--focus') {
        // bring the window to front first (input controllers ignore an unfocused document)
        focus = true;
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

const wrapped = awaitPromise ? `(async () => { return ${expression}; })()` : expression;
const result = await call('Runtime.evaluate', {
    expression: wrapped,
    awaitPromise,
    returnByValue: true
});
ws.close();

if (result.exceptionDetails) {
    console.error(JSON.stringify(result.exceptionDetails, null, 2));
    process.exit(1);
}
console.log(JSON.stringify(result.result.value ?? result.result, null, 2));
