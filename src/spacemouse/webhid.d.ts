// [custom] Minimal WebHID ambient types — TypeScript's lib.dom does not ship them.
// Only the surface used by webhid-backend.ts.
/* eslint-disable no-undef */

interface HIDReportInfo {
    readonly reportId: number;
}

interface HIDCollectionInfo {
    readonly usagePage: number;
    readonly usage: number;
    readonly inputReports?: HIDReportInfo[];
}

interface HIDInputReportEvent extends Event {
    readonly device: HIDDevice;
    readonly reportId: number;
    readonly data: DataView;
}

interface HIDConnectionEvent extends Event {
    readonly device: HIDDevice;
}

interface HIDDevice extends EventTarget {
    readonly opened: boolean;
    readonly vendorId: number;
    readonly productId: number;
    readonly productName: string;
    readonly collections: HIDCollectionInfo[];
    open(): Promise<void>;
    close(): Promise<void>;
    forget(): Promise<void>;
    sendReport(reportId: number, data: BufferSource): Promise<void>;
    oninputreport: ((this: HIDDevice, ev: HIDInputReportEvent) => any) | null;
}

interface HIDDeviceFilter {
    vendorId?: number;
    productId?: number;
    usagePage?: number;
    usage?: number;
}

interface HID extends EventTarget {
    getDevices(): Promise<HIDDevice[]>;
    requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
    addEventListener(type: 'connect' | 'disconnect', listener: (ev: HIDConnectionEvent) => any): void;
    removeEventListener(type: 'connect' | 'disconnect', listener: (ev: HIDConnectionEvent) => any): void;
}

interface Navigator {
    readonly hid?: HID;
}
