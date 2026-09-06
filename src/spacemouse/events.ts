// [custom] SpaceMouse events + tuning state, following the editor's convention:
//   `spacemouse.foo`     getter (events.function) and change notification (events.fire)
//   `spacemouse.setFoo`  command (events.on)
// preferences.ts persists enabled/scale/rotationScale/deadzone/invert through exactly these names.

import { DEFAULT_DEADZONE } from './curve';
import { SpaceMouseState } from './state';
import { WebHidBackend } from './webhid-backend';
import { Events } from '../events';

export type SpaceMouseTuning = {
    enabled: boolean;
    /** translation speed multiplier on top of camera.flySpeed */
    scale: number;
    /**
     * rotation speed multiplier, independent of scale (user CR 2026-09-06:
     * at equal gain rotation feels far too fast next to movement)
     */
    rotationScale: number;
    deadzone: number;
    /** per-axis invert flags in desk-frame order tx, ty, tz, rx, ry, rz */
    invert: boolean[];
    debug: boolean;
};

export type SpaceMouseInstance = {
    backend: WebHidBackend;
    state: SpaceMouseState;
    tuning: SpaceMouseTuning;
};

export const registerSpaceMouseEvents = (events: Events): SpaceMouseInstance => {
    const state = new SpaceMouseState(() => performance.now(), 100);
    const backend = new WebHidBackend(state);
    const tuning: SpaceMouseTuning = {
        enabled: true,
        scale: 1,
        rotationScale: 0.5,
        deadzone: DEFAULT_DEADZONE,
        invert: [false, false, false, false, false, false],
        debug: false
    };
    const instance: SpaceMouseInstance = { backend, state, tuning };

    events.function('spacemouse.instance', () => instance);
    events.function('spacemouse.available', () => backend.available);
    events.function('spacemouse.connected', () => backend.connected);
    events.function('spacemouse.deviceName', () => backend.deviceName);

    backend.onConnectionChange = (connected: boolean) => {
        events.fire('spacemouse.connected', connected);
    };

    events.on('spacemouse.connect', () => {
        backend.requestDevice().catch(() => {});
    });

    events.on('spacemouse.disconnect', () => {
        backend.close().catch(() => {});
    });

    // enabled

    const setEnabled = (value: boolean) => {
        if (value !== tuning.enabled) {
            tuning.enabled = value;
            events.fire('spacemouse.enabled', value);
        }
    };
    events.function('spacemouse.enabled', () => tuning.enabled);
    events.on('spacemouse.setEnabled', (value: boolean) => setEnabled(!!value));

    // scale

    const setScale = (value: number) => {
        if (value !== tuning.scale) {
            tuning.scale = value;
            events.fire('spacemouse.scale', value);
        }
    };
    events.function('spacemouse.scale', () => tuning.scale);
    events.on('spacemouse.setScale', (value: number) => setScale(value));

    // rotation scale

    const setRotationScale = (value: number) => {
        if (value !== tuning.rotationScale) {
            tuning.rotationScale = value;
            events.fire('spacemouse.rotationScale', value);
        }
    };
    events.function('spacemouse.rotationScale', () => tuning.rotationScale);
    events.on('spacemouse.setRotationScale', (value: number) => setRotationScale(value));

    // deadzone

    const setDeadzone = (value: number) => {
        if (value !== tuning.deadzone) {
            tuning.deadzone = value;
            events.fire('spacemouse.deadzone', value);
        }
    };
    events.function('spacemouse.deadzone', () => tuning.deadzone);
    events.on('spacemouse.setDeadzone', (value: number) => setDeadzone(value));

    // invert flags

    const setInvert = (value: boolean[]) => {
        const next = Array.from({ length: 6 }, (_, i) => !!value?.[i]);
        if (next.some((v, i) => v !== tuning.invert[i])) {
            tuning.invert = next;
            events.fire('spacemouse.invert', next.slice());
        }
    };
    events.function('spacemouse.invert', () => tuning.invert.slice());
    events.on('spacemouse.setInvert', (value: boolean[]) => setInvert(value));

    // debug dump (calibration): ?spacemouseDebug=1 or spacemouse.setDebug

    const setDebug = (value: boolean) => {
        if (value !== tuning.debug) {
            tuning.debug = value;
            backend.debug = value;
            events.fire('spacemouse.debug', value);
        }
    };
    events.function('spacemouse.debug', () => tuning.debug);
    events.on('spacemouse.setDebug', (value: boolean) => setDebug(!!value));

    if (new URL(location.href).searchParams.get('spacemouseDebug') === '1') {
        setDebug(true);
    }

    backend.start();

    return instance;
};
