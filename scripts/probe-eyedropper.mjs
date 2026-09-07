// [custom] Probe what the eyedropper "sees" on the current view of the running
// app: find pixels of a target colour in an offscreen render, pick the frontmost
// splat under each (the ID pass the eyedropper samples), and compare the pixel
// colour with that splat's final colour and its stored opacity / size from the
// PLY. Answers "is the picked splat the one the user means?" for M4.
//
// usage: node scripts/probe-eyedropper.mjs --ply <file.ply> [--port 9222] [--max 60]
//        [--target blue|green]   (blue = light sky pixels, the default)

import fs from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = Number(arg('--port', 9222));
const plyFile = arg('--ply', null);
const max = Number(arg('--max', 60));
const target = arg('--target', 'blue');
if (!plyFile) {
    console.error('usage: node scripts/probe-eyedropper.mjs --ply <file.ply> [--port 9222] [--max 60] [--target blue|green]');
    process.exit(2);
}

// ---- PLY (float32 binary) ----
const buffer = fs.readFileSync(plyFile);
const headerEnd = buffer.indexOf('end_header\n') + 'end_header\n'.length;
const header = buffer.subarray(0, headerEnd).toString('ascii').split('\n');
const count = Number(header.find(l => l.startsWith('element vertex')).split(' ')[2]);
const props = header.filter(l => l.startsWith('property')).map(l => l.split(' ')[2]);
const stride = props.length * 4;
const view = new DataView(buffer.buffer, buffer.byteOffset + headerEnd);
const col = name => props.indexOf(name);
const read = (i, p) => view.getFloat32(i * stride + p * 4, true);
const SH_C0 = 0.28209479177387814;
const sigmoid = x => 1 / (1 + Math.exp(-x));
const clamp01 = v => Math.min(1, Math.max(0, v));
const row = (i) => ({
    rgb: [0, 1, 2].map(c => clamp01(0.5 + SH_C0 * read(i, col(`f_dc_${c}`)))),
    opacity: sigmoid(read(i, col('opacity'))),
    size: Math.cbrt(Math.exp(read(i, col('scale_0'))) * Math.exp(read(i, col('scale_1'))) * Math.exp(read(i, col('scale_2'))))
});

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const oklab = ([r, g, b]) => {
    r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
};
const deltaE = (a, b) => {
    const x = oklab(a), y = oklab(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

// ---- CDP ----
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
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
};

// --camera-from <port>: copy the camera pose (position + focal point) of the
// app on that port, so a harness instance shows the user's current view
const cameraFrom = arg('--camera-from', null);
if (cameraFrom) {
    const srcTargets = await (await fetch(`http://127.0.0.1:${cameraFrom}/json`)).json();
    const srcPage = srcTargets.find(t => t.type === 'page' && t.url.startsWith('app://'));
    if (!srcPage) {
        console.error('no app page target on port', cameraFrom);
        process.exit(2);
    }
    const srcWs = new WebSocket(srcPage.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        srcWs.onopen = resolve;
        srcWs.onerror = reject;
    });
    const pose = await new Promise((resolve, reject) => {
        const id = 1;
        srcWs.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id === id) {
                if (msg.error) reject(new Error(msg.error.message));
                else resolve(msg.result.result.value);
            }
        });
        srcWs.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
            expression: `((c) => ({ p: [c.position.x, c.position.y, c.position.z], t: [c.focalPoint.x, c.focalPoint.y, c.focalPoint.z] }))(window.scene.camera)`,
            returnByValue: true
        } }));
    });
    srcWs.close();
    await evaluate(`(async () => {
        const V = window.scene.camera.focalPoint.constructor;
        window.scene.camera.setPose(new V(${pose.p.join(',')}), new V(${pose.t.join(',')}), 0);
        await new Promise(r => setTimeout(r, 400));
        return true;
    })()`);
    console.log(`camera copied from port ${cameraFrom}: position ${pose.p.map(v => v.toFixed(2)).join(',')} target ${pose.t.map(v => v.toFixed(2)).join(',')}`);
}

// pixel predicate in-page: light blue = blue dominant and bright; green = green dominant
const predicate = target === 'green' ?
    '(r, g, b) => g > r + 10 && g > b + 10 && g > 60' :
    '(r, g, b) => b > g + 8 && b > r + 25 && b > 120';

const probe = await evaluate(`(async () => {
    const events = window.scene.events;
    const splat = events.invoke('selection');
    const ts = window.scene.targetSize;
    const w = Math.round(ts.width / 2), h = Math.round(ts.height / 2);
    // the first offscreen render after other GPU work has come back empty once; render twice
    await events.invoke('render.offscreen', w, h);
    const data = await events.invoke('render.offscreen', w, h);
    const isTarget = ${predicate};
    const hits = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (isTarget(data[i], data[i + 1], data[i + 2])) hits.push([x, y]);
        }
    }
    const step = Math.max(1, Math.floor(hits.length / ${max}));
    const points = [];
    for (let k = 0; k < hits.length && points.length < ${max}; k += step) {
        const [x, y] = hits[k];
        const nx = (x + 0.5) / w, ny = (y + 0.5) / h;
        const i = (y * w + x) * 4;
        window.scene.camera.pickPrep(splat, 'set');
        const ids = await window.scene.camera.pickRect(nx, ny, 1 / ts.width, 1 / ts.height);
        const id = ids?.[0];
        const picked = (id === undefined || id === 0xffffffff) ? null : await events.invoke('select.colorSample', { x: nx, y: ny });
        points.push({ nx, ny, pixel: [data[i], data[i + 1], data[i + 2]].map(v => v / 255), id: (id === 0xffffffff ? null : id), picked });
    }
    return { w, h, targetPixels: hits.length, count: splat.instances.count, points };
})()`);
// --hide-test: select splats whose FINAL colour is within a tolerance of the
// probed pixel colours (the eyedropper kernel), hide them, re-render and count
// how many target pixels survive. Tells whether the target pixels are produced
// by splats of that colour at all (or by blending of other colours). The
// selection and hide ops are undone afterwards.
if (args.includes('--hide-test')) {
    // --refs N: how many probed pixel colours serve as references (1 = a single click)
    const refCount = Number(arg('--refs', 12));
    const pixels = probe.points.map(p => p.pixel);
    const refs = refCount === 1 ?
        [pixels.map(c => c.map(v => v)).sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))[Math.floor(pixels.length / 2)]] :
        pixels.filter((_, i) => i % Math.max(1, Math.floor(pixels.length / refCount)) === 0);
    console.log(`hide-test refs: ${refs.map(c => c.map(v => v.toFixed(2)).join(',')).join(' | ')}`);
    for (const tol of [0.06, 0.1, 0.14, 0.2]) {
        const result = await evaluate(`(async () => {
            const events = window.scene.events;
            const splat = events.invoke('selection');
            const before = splat.instances.numSelected;
            await events.invoke('select.colorMatch', 'set', ${JSON.stringify(refs)}, { metric: 'oklab', tolerance: ${tol} });
            const selected = splat.instances.numSelected;
            events.fire('select.hide');
            await new Promise(r => setTimeout(r, 300));
            const ts = window.scene.targetSize;
            const w = Math.round(ts.width / 2), h = Math.round(ts.height / 2);
            await events.invoke('render.offscreen', w, h);
            const data = await events.invoke('render.offscreen', w, h);
            const isTarget = ${predicate};
            let remaining = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (isTarget(data[i], data[i + 1], data[i + 2])) remaining++;
            }
            events.fire('edit.undo');
            events.fire('edit.undo');
            await new Promise(r => setTimeout(r, 300));
            return { selected, remaining, restored: splat.instances.numSelected === before };
        })()`);
        console.log(`hide-test tolerance ${tol}: ${result.selected} splats match the pixel colours; hiding them leaves ${result.remaining}/${probe.targetPixels} ${target} pixels (${(100 * result.remaining / probe.targetPixels).toFixed(1)}%); state restored: ${result.restored}`);
    }
}
// --stroke-test: what one drag across the target pixels yields. A synthetic
// stroke through the probed points goes to select.colorSampleRegion (the
// tool's drag gesture), and the resulting references run the hide test.
if (args.includes('--stroke-test')) {
    const stroke = [...probe.points].sort((a, b) => a.nx - b.nx).map(p => ({ x: p.nx, y: p.ny }));
    const refs = await evaluate(`window.scene.events.invoke('select.colorSampleRegion', ${JSON.stringify(stroke)}, 16)`);
    console.log(`stroke-test: ${stroke.length} stroke points -> ${refs.length} references: ${refs.map(c => c.map(v => v.toFixed(2)).join(',')).join(' | ')}`);
    for (const tol of [0.06, 0.08, 0.1, 0.12]) {
        const result = await evaluate(`(async () => {
            const events = window.scene.events;
            const splat = events.invoke('selection');
            const before = splat.instances.numSelected;
            await events.invoke('select.colorMatch', 'set', ${JSON.stringify(refs)}, { metric: 'oklab', tolerance: ${tol} });
            const selected = splat.instances.numSelected;
            events.fire('select.hide');
            await new Promise(r => setTimeout(r, 300));
            const ts = window.scene.targetSize;
            const w = Math.round(ts.width / 2), h = Math.round(ts.height / 2);
            await events.invoke('render.offscreen', w, h);
            const data = await events.invoke('render.offscreen', w, h);
            const isTarget = ${predicate};
            let remaining = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (isTarget(data[i], data[i + 1], data[i + 2])) remaining++;
            }
            events.fire('edit.undo');
            events.fire('edit.undo');
            await new Promise(r => setTimeout(r, 300));
            return { selected, remaining, restored: splat.instances.numSelected === before };
        })()`);
        console.log(`stroke-test tolerance ${tol}: ${result.selected} splats; hiding them leaves ${result.remaining}/${probe.targetPixels} ${target} pixels (${(100 * result.remaining / probe.targetPixels).toFixed(1)}%); restored: ${result.restored}`);
    }
}

// --dump <dir>: select with the pixel-colour refs at --dump-tol (default 0.1),
// screenshot the selection and the scene with it hidden, report where the
// selected splats sit in view depth relative to the rest, then undo.
if (args.includes('--dump')) {
    const dir = arg('--dump', '.');
    const tol = Number(arg('--dump-tol', 0.1));
    fs.mkdirSync(dir, { recursive: true });
    const refs = probe.points.map(p => p.pixel).filter((_, i) => i % Math.max(1, Math.floor(probe.points.length / 12)) === 0);
    const shot = async (name) => {
        const png = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`${dir}/${name}`, Buffer.from(png.data, 'base64'));
    };
    const state = await evaluate(`(async () => {
        const events = window.scene.events;
        const splat = events.invoke('selection');
        await events.invoke('select.colorMatch', 'set', ${JSON.stringify(refs)}, { metric: 'oklab', tolerance: ${tol} });
        await new Promise(r => setTimeout(r, 300));
        return {
            selected: splat.instances.numSelected,
            flags: Array.from(splat.instances.flags),
            view: Array.from(window.scene.camera.camera.viewMatrix.data),
            world: Array.from(splat.entity.getWorldTransform().data)
        };
    })()`);
    await shot('selected.png');
    await evaluate(`(async () => { window.scene.events.fire('select.hide'); await new Promise(r => setTimeout(r, 400)); return true; })()`);
    await shot('hidden.png');
    await evaluate(`(async () => { window.scene.events.fire('edit.undo'); window.scene.events.fire('edit.undo'); await new Promise(r => setTimeout(r, 300)); return true; })()`);

    // view depth of every splat: view * world * p
    const mul = (m, p) => [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
    const depths = [];
    for (let i = 0; i < count; i++) {
        const p = mul(state.view, mul(state.world, [read(i, col('x')), read(i, col('y')), read(i, col('z'))]));
        depths.push(-p[2]);
    }
    const sel = depths.filter((_, i) => state.flags[i] === 1);
    const other = depths.filter((_, i) => state.flags[i] !== 1);
    const quant = (v, qs = [0.1, 0.25, 0.5, 0.75, 0.9]) => {
        const s = [...v].sort((a, b) => a - b);
        return qs.map(x => s[Math.min(s.length - 1, Math.floor(x * s.length))].toFixed(2)).join(' / ');
    };
    console.log(`dump: tolerance ${tol} selected ${state.selected}; screenshots ${dir}/selected.png, hidden.png`);
    console.log(`  view depth p10/p25/p50/p75/p90  selected: ${quant(sel)}  others: ${quant(other)}`);
    const selMedian = Number(quant(sel, [0.5]));
    console.log(`  others nearer than the selected median depth: ${other.filter(d => d < selMedian).length}/${other.length}; selected nearer than that: ${sel.filter(d => d < selMedian).length}/${sel.length}`);
}
ws.close();

console.log(`${target} pixels in a ${probe.w}x${probe.h} render: ${probe.targetPixels} (${(100 * probe.targetPixels / (probe.w * probe.h)).toFixed(1)}%), probing ${probe.points.length}; splats ${probe.count} (ply rows ${count})`);

const pts = probe.points.filter(p => p.id !== null && p.id < count).map(p => ({ ...p, stored: row(p.id) }));
console.log(`picks that hit a splat: ${pts.length}/${probe.points.length}, distinct ids: ${new Set(pts.map(p => p.id)).size}`);
const q = (values, qs = [0.1, 0.5, 0.9]) => {
    const s = [...values].sort((a, b) => a - b);
    return qs.map(x => s[Math.min(s.length - 1, Math.floor(x * s.length))].toFixed(3)).join(' / ');
};
console.log('picked splat opacity p10/p50/p90:', q(pts.map(p => p.stored.opacity)));
console.log('picked splat size p10/p50/p90:', q(pts.map(p => p.stored.size)));
console.log('OKLab dE pixel vs picked splat final colour p10/p50/p90:', q(pts.map(p => deltaE(p.pixel, p.picked ?? p.stored.rgb))));
console.log('OKLab dE pixel vs picked splat stored colour p10/p50/p90:', q(pts.map(p => deltaE(p.pixel, p.stored.rgb))));
const blueish = c => c[2] > c[1] && c[2] > c[0];
console.log(`picked splats whose final colour is blue-dominant: ${pts.filter(p => blueish(p.picked ?? p.stored.rgb)).length}/${pts.length}; stored colour blue-dominant: ${pts.filter(p => blueish(p.stored.rgb)).length}/${pts.length}`);
console.log(`picked splats with opacity < 0.15: ${pts.filter(p => p.stored.opacity < 0.15).length}/${pts.length}`);

// how many PLY splats a tolerance around the *pixel* colours would catch vs around the *picked* colours
const rows = Array.from({ length: count }, (_, i) => row(i));
const within = (refs, tol) => rows.filter(r => refs.some(ref => deltaE(r.rgb, ref) <= tol)).length;
for (const tol of [0.08, 0.12, 0.16]) {
    console.log(`tolerance ${tol}: refs = pixel colours -> ${within(pts.map(p => p.pixel), tol)} splats; refs = picked final colours -> ${within(pts.map(p => p.picked ?? p.stored.rgb), tol)} splats`);
}
console.log('\nsample rows (pixel | picked final | stored | opacity | size):');
for (const p of pts.slice(0, 12)) {
    const f = c => c.map(v => v.toFixed(2)).join(',');
    console.log(`  ${f(p.pixel)} | ${p.picked ? f(p.picked) : '-'} | ${f(p.stored.rgb)} | ${p.stored.opacity.toFixed(3)} | ${p.stored.size.toFixed(3)}`);
}
