// [custom] WebHID backend: opens the SpaceMouse and feeds parsed reports into the state cache.
//
// Browser: `requestDevice()` needs a user gesture (Settings → Connect); the grant is
// remembered, so `autoConnect()` re-opens it on the next start via `getDevices()`.
// Electron: electron/hid.ts auto-grants 046D:C62B, so `autoConnect()` succeeds without
// any gesture and `select-hid-device` answers `requestDevice()` picker-less.
//
// 3DxWare (Windows) does not lock the device — Chromium opens it shared — so reports
// arrive here AND the driver keeps acting (synthesized wheel events, button overlays);
// see 04-3dxware-coexistence.md and the wheel gate in controllers.ts.

/* global HIDDeviceFilter */

import { parseReport } from './report-parser';
import { SpaceMouseState } from './state';

/** SpaceMouse Pro, wired. Other 6-DOF devices are added here once calibrated. */
export const SPACEMOUSE_FILTERS: HIDDeviceFilter[] = [
    { vendorId: 0x046d, productId: 0xc62b }
];

const isSixDof = (device: HIDDevice) => device.collections.some(c => c.usagePage === 0x01 && c.usage === 0x08);

const isSupported = (device: HIDDevice) => {
    return SPACEMOUSE_FILTERS.some(f => f.vendorId === device.vendorId && f.productId === device.productId) && isSixDof(device);
};

const hex = (data: DataView) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
};

export class WebHidBackend {
    device: HIDDevice | null = null;

    /** dump raw reports to the console (calibration procedure) */
    debug = false;

    onConnectionChange: (connected: boolean, device: HIDDevice | null) => void = () => {};

    private started = false;

    constructor(readonly state: SpaceMouseState) {}

    get available() {
        return typeof navigator !== 'undefined' && !!navigator.hid;
    }

    get connected() {
        return !!this.device?.opened;
    }

    get deviceName() {
        return this.device?.productName ?? '';
    }

    /** Register hotplug/focus listeners and try to reopen a previously granted device. */
    start() {
        if (this.started || !this.available) {
            return;
        }
        this.started = true;

        navigator.hid.addEventListener('connect', this.onConnect);
        navigator.hid.addEventListener('disconnect', this.onDisconnect);
        window.addEventListener('blur', this.onBlur);
        document.addEventListener('visibilitychange', this.onVisibility);

        this.autoConnect().catch(() => {});
    }

    stop() {
        if (!this.started) {
            return;
        }
        this.started = false;
        navigator.hid.removeEventListener('connect', this.onConnect);
        navigator.hid.removeEventListener('disconnect', this.onDisconnect);
        window.removeEventListener('blur', this.onBlur);
        document.removeEventListener('visibilitychange', this.onVisibility);
        this.close().catch(() => {});
    }

    /** Open an already-granted device without a user gesture. */
    async autoConnect(): Promise<boolean> {
        if (!this.available) {
            return false;
        }
        try {
            const devices = await navigator.hid.getDevices();
            const device = devices.find(isSupported);
            return device ? this.open(device) : false;
        } catch (error) {
            console.warn('[spacemouse] getDevices failed', error);
            return false;
        }
    }

    /** Ask for the device; must be called from a user gesture in a browser. */
    async requestDevice(): Promise<boolean> {
        if (!this.available) {
            return false;
        }
        try {
            const devices = await navigator.hid.requestDevice({ filters: SPACEMOUSE_FILTERS });
            const device = devices.find(isSupported) ?? devices[0];
            return device ? this.open(device) : false;
        } catch (error) {
            console.warn('[spacemouse] requestDevice failed', error);
            return false;
        }
    }

    async close() {
        const device = this.device;
        if (!device) {
            return;
        }
        device.oninputreport = null;
        this.device = null;
        this.state.clear();
        try {
            if (device.opened) {
                await device.close();
            }
        } catch {
            // closing a removed device throws; nothing to do
        }
        this.onConnectionChange(false, null);
    }

    private async open(device: HIDDevice): Promise<boolean> {
        if (this.device === device && device.opened) {
            return true;
        }
        await this.close();
        try {
            if (!device.opened) {
                await device.open();
            }
        } catch (error) {
            console.warn(`[spacemouse] open failed for ${device.productName}`, error);
            return false;
        }
        device.oninputreport = this.handleReport;
        this.device = device;
        this.state.clear();
        this.onConnectionChange(true, device);
        return true;
    }

    private handleReport = (event: HIDInputReportEvent) => {
        const report = parseReport(event.reportId, event.data);
        if (this.debug) {
            console.log(`[spacemouse] id=${event.reportId} [${hex(event.data)}] -> ${JSON.stringify(report)}`);
        }
        this.state.apply(report);
    };

    private onConnect = (event: HIDConnectionEvent) => {
        if (!this.device && isSupported(event.device)) {
            this.open(event.device).catch(() => {});
        }
    };

    private onDisconnect = (event: HIDConnectionEvent) => {
        if (event.device === this.device) {
            this.close().catch(() => {});
        }
    };

    // halt, don't freeze mid-motion, and never fly the camera while the user types elsewhere
    private onBlur = () => {
        this.state.clear();
    };

    private onVisibility = () => {
        if (document.visibilityState !== 'visible') {
            this.state.clear();
        }
    };
}
