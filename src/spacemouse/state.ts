// [custom] Frame-latched SpaceMouse state (03-integration-pattern.md).
//
// Reports arrive at 125 Hz on the HID callback; the app consumes ONE idempotent snapshot
// per frame. Button edges are computed at snapshot time. The axis cache zeroes itself
// when no report has arrived for `ttlMs` (dropped packets, receivers that skip the
// 3×-zero stop signal) and on explicit clear() (focus loss, device removal).

import { Axes, ParsedReport, ZERO_AXES } from './report-parser';

export type Snapshot = {
    axes: Axes;
    /** any axis outside the raw deadzone (report-level, before the response curve) */
    active: boolean;
    /** rotation axes active — used to suppress driver-synthesized wheel events */
    rotating: boolean;
    buttons: number;
    /** bits that went 0 → 1 since the previous snapshot */
    pressed: number;
    /** bits that went 1 → 0 since the previous snapshot */
    released: number;
    /** ms since the last axis report, Infinity if none */
    ageMs: number;
};

const ACTIVE_EPSILON = 0.005;

export class SpaceMouseState {
    private axes: Axes = { ...ZERO_AXES };

    private lastAxisTime = -Infinity;

    private buttons = 0;

    private prevButtons = 0;

    constructor(private readonly now: () => number, private readonly ttlMs = 100) {}

    apply(report: ParsedReport) {
        switch (report.kind) {
            case 'translation':
                this.axes.tx = report.tx;
                this.axes.ty = report.ty;
                this.axes.tz = report.tz;
                this.lastAxisTime = this.now();
                break;
            case 'rotation':
                this.axes.rx = report.rx;
                this.axes.ry = report.ry;
                this.axes.rz = report.rz;
                this.lastAxisTime = this.now();
                break;
            case 'combined':
                this.axes = { ...report.axes };
                this.lastAxisTime = this.now();
                break;
            case 'buttons':
                this.buttons = report.mask >>> 0;
                break;
            default:
                break;
        }
    }

    /** Zero everything (focus loss, disconnect). Button edges are dropped, not replayed. */
    clear() {
        this.axes = { ...ZERO_AXES };
        this.lastAxisTime = -Infinity;
        this.buttons = 0;
        this.prevButtons = 0;
    }

    snapshot(): Snapshot {
        const ageMs = this.now() - this.lastAxisTime;
        const expired = ageMs > this.ttlMs;
        if (expired && this.lastAxisTime !== -Infinity) {
            this.axes = { ...ZERO_AXES };
        }

        const axes = { ...this.axes };
        const translating = Math.abs(axes.tx) > ACTIVE_EPSILON || Math.abs(axes.ty) > ACTIVE_EPSILON || Math.abs(axes.tz) > ACTIVE_EPSILON;
        const rotating = Math.abs(axes.rx) > ACTIVE_EPSILON || Math.abs(axes.ry) > ACTIVE_EPSILON || Math.abs(axes.rz) > ACTIVE_EPSILON;

        const pressed = (this.buttons & ~this.prevButtons) >>> 0;
        const released = (this.prevButtons & ~this.buttons) >>> 0;
        this.prevButtons = this.buttons;

        return {
            axes,
            active: translating || rotating,
            rotating,
            buttons: this.buttons,
            pressed,
            released,
            ageMs: this.lastAxisTime === -Infinity ? Infinity : ageMs
        };
    }
}
