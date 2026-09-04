// [custom] Device and permission policy for the editor's own origin.
//
// WebHID in Electron shows no device picker: `select-hid-device` must answer
// `navigator.hid.requestDevice()`, and `setDevicePermissionHandler` lets
// `navigator.hid.getDevices()` return the SpaceMouse without a user gesture.
// The File System Access API (showOpenFilePicker etc.) is brokered through
// `setPermissionRequestHandler`.

import type { Session } from 'electron';

export type HidId = { vendorId: number, productId: number, name: string };

/** SpaceMouse Pro, wired (Logitech VID era). See ~/.claude/spacemouse-knowledge/01-device-protocol.md */
export const SPACEMOUSE_DEVICES: HidId[] = [
    { vendorId: 0x046d, productId: 0xc62b, name: 'SpaceMouse Pro' }
];

const isSpaceMouse = (device: { vendorId?: number, productId?: number }) => {
    return SPACEMOUSE_DEVICES.some(d => d.vendorId === device.vendorId && d.productId === device.productId);
};

/**
 * @param appOrigin serialized origin of the editor, e.g. `app://editor` (no trailing slash —
 * Chromium reports `details.origin` / `requestingOrigin` in that form; full URLs are accepted too)
 */
export const installDevicePolicies = (ses: Session, appOrigin: string) => {
    const origin = appOrigin.replace(/\/+$/, '');
    const isOwnOrigin = (url: string | undefined) => !!url && (url === origin || url.startsWith(`${origin}/`));

    // fileSystem (File System Access API), clipboard, etc. — granted to our own
    // origin only, denied to anything else that might get loaded.
    ses.setPermissionRequestHandler((webContents, _permission, callback) => {
        callback(isOwnOrigin(webContents?.getURL()));
    });

    ses.setPermissionCheckHandler((_webContents, _permission, requestingOrigin) => {
        return isOwnOrigin(requestingOrigin);
    });

    // grants HID access to the SpaceMouse without requestDevice()
    ses.setDevicePermissionHandler((details) => {
        if (details.deviceType !== 'hid') {
            return false;
        }
        // details.device is typed as the union across device types
        return isOwnOrigin(details.origin) && isSpaceMouse(details.device as { vendorId?: number, productId?: number });
    });

    // answers navigator.hid.requestDevice() without a picker
    ses.on('select-hid-device', (event, details, callback) => {
        event.preventDefault();
        // deviceList is typed as the union across select-*-device events
        const device = details.deviceList.find(d => isSpaceMouse(d as { vendorId?: number, productId?: number }));
        callback(device?.deviceId);
    });
};
