// [custom] SpaceMouse → camera (fly mode only). One snapshot per frame, velocity × clamped dt.
//
// Mapping (03-integration-pattern.md): TX → strafe camera-right, TY (push/pull) → along the
// horizontal camera forward, TZ (lift) → world up, RZ (twist) → yaw about world up,
// RX → pitch about camera right. RY (roll) is ignored — SuperSplat's orbit camera cannot
// roll (camera.ts: setLocalEulerAngles(elev, azim, 0)).
//
// Rotation is about the CAMERA POSITION (fly look), mirroring camera.look() but with
// damping 0 so translation and rotation in the same frame do not fight the tweens.
//
// DEFAULT_SIGNS: desk-frame axis sign → fly action. Measured on this app with a wired
// SpaceMouse Pro (046D:C62B) via scripts/spacemouse-calibrate.mjs on 2026-09-05:
// slide right +TX · push away −TY · lift −TZ · nose-down −RX · top-right −RY · twist CW +RZ
// (identical to the Spirula measurement). Re-run 05-calibration-procedure.md for other devices.

import { math, Vec3 } from 'playcanvas';

import { clampDeltaTime, shape } from './curve';
import { SpaceMouseInstance } from './events';
import { buttonBit, SpaceMouseProButton } from './report-parser';
import type { Camera } from '../camera';
import { Events } from '../events';

const DEFAULT_SIGNS = { tx: 1, ty: -1, tz: -1, rx: -1, ry: -1, rz: 1 };

/**
 * focal distances per second at full deflection, × camera.flySpeed × spacemouse.scale.
 * Relative to Camera.focalDistance so huge and tiny scenes both fly sensibly; 2 matches the
 * fly-tested 3 units/s on the fixture scene (focal distance ≈ 1.4 there), 2026-09-05.
 */
const TRANSLATE_SPEED = 2;
/**
 * degrees per second at full deflection, × spacemouse.rotationScale (default 0.5 → 90°/s).
 * 180 was fly-tested 2026-09-05 at the shared scale; the separate rotation gain came from
 * user feedback that rotation felt too fast next to movement (2026-09-06).
 */
const ROTATE_SPEED = 180;
/** how long after the last rotation report driver-synthesized wheel events are swallowed */
const WHEEL_SUPPRESS_MS = 250;

// work vectors
const backward = new Vec3();
const cameraPos = new Vec3();
const focal = new Vec3();
const forward = new Vec3();
const right = new Vec3();
const move = new Vec3();

// same as Camera.calcForwardVec (kept local to avoid a camera.ts ↔ controller import cycle):
// the vector from the focal point TOWARDS the camera for a given azim/elev
const calcBackward = (result: Vec3, azim: number, elev: number) => {
    const ex = elev * math.DEG_TO_RAD;
    const ey = azim * math.DEG_TO_RAD;
    const s1 = Math.sin(-ex);
    const c1 = Math.cos(-ex);
    const s2 = Math.sin(-ey);
    const c2 = Math.cos(-ey);
    result.set(-c1 * s2, s1, c1 * c2);
};

export class SpaceMouseController {
    private instance: SpaceMouseInstance | null;

    private wasActive = false;

    private lastRotationTime = -Infinity;

    constructor(private readonly camera: Camera, private readonly events: Events) {
        this.instance = (events.invoke('spacemouse.instance') as SpaceMouseInstance) ?? null;
    }

    /** true shortly after puck rotation: gate for 3DxWare's synthesized wheel events */
    rotationActive() {
        return performance.now() - this.lastRotationTime < WHEEL_SUPPRESS_MS;
    }

    update(deltaTime: number) {
        const instance = this.instance;
        if (!instance || !instance.tuning.enabled || !instance.backend.connected) {
            this.wasActive = false;
            return;
        }

        const snapshot = instance.state.snapshot();

        // button edges act even without deflection
        this.handleButtons(snapshot.pressed);

        const { scene } = this.camera;
        if (!snapshot.active || !document.hasFocus() || scene.suspendRender || scene.lockedRenderMode) {
            this.wasActive = false;
            return;
        }

        if (!this.wasActive) {
            this.wasActive = true;
            // cancels timeline playback like any pointer gesture
            this.events.fire('camera.controller', 'spacemouse');
            if (this.camera.controlMode !== 'fly') {
                this.events.fire('camera.setControlMode', 'fly');
            }
        }

        const dt = clampDeltaTime(deltaTime);
        if (dt === 0) {
            return;
        }

        const { tuning } = instance;
        const { axes, buttons } = snapshot;
        const inv = tuning.invert;
        const axis = (value: number, sign: number, index: number) => {
            return shape(value, tuning.deadzone) * sign * (inv[index] ? -1 : 1);
        };

        // ROTATE is hold-to-lock (not a toggle): a stray press during setup must not
        // silently disable rotation with nothing in the UI to show it
        const rotationLocked = (buttons & buttonBit('ROTATE')) !== 0;

        const strafeRight = axis(axes.tx, DEFAULT_SIGNS.tx, 0);
        const flyForward = axis(axes.ty, DEFAULT_SIGNS.ty, 1);
        const moveUp = axis(axes.tz, DEFAULT_SIGNS.tz, 2);
        const pitchDown = rotationLocked ? 0 : axis(axes.rx, DEFAULT_SIGNS.rx, 3);
        const yawRight = rotationLocked ? 0 : axis(axes.rz, DEFAULT_SIGNS.rz, 5);

        const fast = (buttons & buttonBit('SHIFT')) !== 0;
        const slow = (buttons & buttonBit('CTRL')) !== 0;
        const speedMod = fast ? 10 : (slow ? 0.1 : 1);

        if (pitchDown !== 0 || yawRight !== 0) {
            this.lastRotationTime = performance.now();
            const rotate = ROTATE_SPEED * tuning.rotationScale * dt;
            this.rotateAboutCamera(yawRight * rotate, pitchDown * rotate);
        }

        if (strafeRight !== 0 || flyForward !== 0 || moveUp !== 0) {
            const factor = TRANSLATE_SPEED * this.camera.focalDistance * this.camera.flySpeed * tuning.scale * speedMod * dt;
            this.translate(strafeRight * factor, flyForward * factor, moveUp * factor);
        }

        // keep the cheap stochastic render path engaged, as a pointer drag would
        scene.forceInteracting = true;
    }

    private rotateAboutCamera(yawDeg: number, pitchDeg: number) {
        const camera = this.camera;
        const d = camera.distance * camera.sceneRadius / camera.fovFactor;

        calcBackward(backward, camera.azim, camera.elevation);
        cameraPos.copy(camera.focalPoint).add(backward.mulScalar(d));

        // yaw right = azimuth decreases (as a rightward mouse drag does); pitch down = elevation
        // decreases (fly-tested 2026-09-05: the opposite sign looked up on nose-down)
        camera.setAzimElev(camera.azim - yawDeg, camera.elevation - pitchDeg, 0);

        // recompute the focal point from the (clamped, wrapped) angles so the camera stays put
        const { azim, elev } = camera.azimElev;
        calcBackward(backward, azim, elev);
        focal.copy(cameraPos).sub(backward.mulScalar(d));
        camera.setFocalPoint(focal, 0);
    }

    private translate(strafeRight: number, flyForward: number, moveUp: number) {
        const camera = this.camera;
        const { azim, elev } = camera.azimElev;

        // horizontal look direction (fixed Y), like the WASD fly controls
        calcBackward(backward, azim, elev);
        forward.copy(backward).mulScalar(-1);
        forward.y = 0;
        if (forward.lengthSq() < 1e-8) {
            // looking straight up/down: derive the heading from azimuth alone
            calcBackward(backward, azim, 0);
            forward.copy(backward).mulScalar(-1);
        }
        forward.normalize();
        right.cross(forward, Vec3.UP).normalize();

        move.set(0, moveUp, 0);
        move.add(right.mulScalar(strafeRight));
        move.add(forward.mulScalar(flyForward));

        camera.setFocalPoint(camera.focalPoint.add(move), 0);
    }

    private handleButtons(pressed: number) {
        if (!pressed) {
            return;
        }
        const has = (name: SpaceMouseProButton) => (pressed & buttonBit(name)) !== 0;

        if (has('FIT')) this.events.fire('camera.focus');
        if (has('MENU')) this.events.fire('camera.toggleControlMode');
        if (has('KEY_1')) this.events.fire('camera.reset');
        if (has('TOP')) this.events.fire('camera.align', 'py');
        if (has('FRONT')) this.events.fire('camera.align', 'pz');
        if (has('RIGHT')) this.events.fire('camera.align', 'px');
        if (has('ESC')) this.events.fire('tool.deactivate');
    }
}
