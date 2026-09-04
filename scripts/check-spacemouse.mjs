// [custom] Headless regression check for the SpaceMouse → camera integration.
//
// Drives the shipped controller with synthetic reports (no hardware needed) through the
// running desktop app and asserts the fly-mode contract:
//   push away  -> camera and focal point move horizontally, orbit mode switches to fly
//   twist CW   -> azimuth changes, camera POSITION stays put (rotation about the camera)
//   lift       -> pure +Y move
//
// usage: node scripts/desktop-start.mjs --remote-debugging-port=9222 test/fixtures/color-clusters.ply
//        node scripts/check-spacemouse.mjs [--port 9222]

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '9222';

const pageScript = `
await (async () => {
    const cam = window.scene.camera;
    const ev = window.scene.events;
    const instance = ev.invoke('spacemouse.instance');
    const st = instance.state;
    const wasEnabled = instance.tuning.enabled;
    instance.tuning.enabled = true;
    const savedConnected = instance.backend.connected;
    // the controller requires a connected backend; fake it for the drive when no device is present
    let restore = null;
    if (!savedConnected) {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(instance.backend), 'connected');
        Object.defineProperty(instance.backend, 'connected', { get: () => true, configurable: true });
        restore = () => { delete instance.backend.connected; void desc; };
    }
    const pose = () => {
        const p = cam.mainCamera.getPosition();
        const f = cam.focalPoint;
        return { pos: [p.x, p.y, p.z], focal: [f.x, f.y, f.z], azim: cam.azim, elev: cam.elevation, mode: ev.invoke('camera.controlMode') };
    };
    const drive = async (report, ms) => {
        const t0 = performance.now();
        await new Promise((res) => {
            const id = setInterval(() => {
                st.apply(report);
                if (performance.now() - t0 > ms) { clearInterval(id); res(); }
            }, 8);
        });
        await new Promise(r => setTimeout(r, 300));
    };
    ev.fire('camera.setControlMode', 'orbit');
    ev.fire('camera.reset');
    await new Promise(r => setTimeout(r, 400));
    const out = { flySpeed: cam.flySpeed, scale: instance.tuning.scale };
    out.start = pose();
    await drive({ kind: 'translation', tx: 0, ty: -1, tz: 0 }, 600);
    out.afterForward = pose();
    await drive({ kind: 'rotation', rx: 0, ry: 0, rz: 1 }, 500);
    out.afterYaw = pose();
    await drive({ kind: 'translation', tx: 0, ty: 0, tz: -1 }, 400);
    out.afterLift = pose();
    instance.tuning.enabled = wasEnabled;
    if (restore) restore();
    return out;
})()
`;

// trim: cdp-eval wraps the expression as `return <expr>`, and a leading newline would make
// that a bare `return` (automatic semicolon insertion)
const result = spawnSync(process.execPath, [path.join(here, 'cdp-eval.mjs'), '--port', port, '--focus', '--await', pageScript.trim()], { encoding: 'utf8' });
if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
}
const r = JSON.parse(result.stdout);

const failures = [];
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// forward: horizontal move, same delta for camera and focal point, mode flips to fly
const camDelta = [0, 1, 2].map(i => r.afterForward.pos[i] - r.start.pos[i]);
const focalDelta = [0, 1, 2].map(i => r.afterForward.focal[i] - r.start.focal[i]);
if (r.afterForward.mode !== 'fly') failures.push(`forward: expected fly mode, got ${r.afterForward.mode}`);
if (!near(camDelta[1], 0, 1e-3)) failures.push(`forward: camera moved vertically by ${camDelta[1]}`);
if (Math.hypot(camDelta[0], camDelta[2]) < 0.3) failures.push(`forward: camera moved only ${Math.hypot(camDelta[0], camDelta[2])} horizontally`);
if (dist(camDelta, focalDelta) > 1e-3) failures.push('forward: camera and focal point moved by different deltas');
if (!near(r.afterForward.azim, r.start.azim, 1e-3) || !near(r.afterForward.elev, r.start.elev, 1e-3)) failures.push('forward: orientation changed');

// yaw: position pinned, azimuth changed by roughly 90°/s × 0.5 s (× scale), elevation unchanged
const yawMoved = dist(r.afterYaw.pos, r.afterForward.pos);
if (yawMoved > 1e-3) failures.push(`yaw: camera position drifted by ${yawMoved}`);
const azimDelta = ((r.afterYaw.azim - r.afterForward.azim + 540) % 360) - 180;
if (Math.abs(azimDelta) < 20 * r.scale) failures.push(`yaw: azimuth changed only ${azimDelta}°`);
if (!near(r.afterYaw.elev, r.afterForward.elev, 1e-3)) failures.push('yaw: elevation changed');

// lift: pure +Y
const liftDelta = [0, 1, 2].map(i => r.afterLift.pos[i] - r.afterYaw.pos[i]);
if (liftDelta[1] < 0.2) failures.push(`lift: moved up only ${liftDelta[1]}`);
if (Math.hypot(liftDelta[0], liftDelta[2]) > 1e-3) failures.push('lift: moved horizontally');

console.log(JSON.stringify({
    forward: { camDelta, mode: r.afterForward.mode },
    yaw: { azimDelta, positionDrift: yawMoved },
    lift: { delta: liftDelta }
}, null, 2));

if (failures.length) {
    console.error(`FAIL\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('PASS spacemouse fly-mode contract');
