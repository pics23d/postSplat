// [custom] SpaceMouse HID report parser — pure functions over bytes, no platform code.
//
// Protocol per ~/.claude/spacemouse-knowledge/01-device-protocol.md:
//   report 1: int16 LE X,Y,Z            (6 payload bytes, "split" devices e.g. SpaceMouse Pro)
//   report 1: int16 LE X,Y,Z,Rx,Ry,Rz   (12 payload bytes, "combined" wireless/receiver devices)
//   report 2: int16 LE Rx,Ry,Rz         (6 payload bytes)
//   report 3: uint32 LE button mask
//   anything else (battery 0x17, long-press 0x10, Enterprise 0x1C/0x1D, ...) is ignored.
// Nominal range is ±350 but real devices overshoot to ~±512: normalize by 350 and clamp to ±1.
//
// The raw frame is the DESK frame: X = cap left/right, Y = cap forward/back (horizontal),
// Z = cap lift/press. Signs are calibrated per app (05-calibration-procedure.md), never here.

export type Axes = {
    tx: number;
    ty: number;
    tz: number;
    rx: number;
    ry: number;
    rz: number;
};

export type ParsedReport =
    | { kind: 'translation', tx: number, ty: number, tz: number }
    | { kind: 'rotation', rx: number, ry: number, rz: number }
    | { kind: 'combined', axes: Axes }
    | { kind: 'buttons', mask: number }
    | { kind: 'ignored', reportId: number, length: number };

export const NOMINAL_RANGE = 350;

export const ZERO_AXES: Readonly<Axes> = Object.freeze({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 });

const normalize = (raw: number) => Math.max(-1, Math.min(1, raw / NOMINAL_RANGE));

const int16At = (data: DataView, offset: number) => normalize(data.getInt16(offset, true));

/**
 * Parse one input report as delivered by WebHID (`event.reportId` + `event.data`,
 * where the DataView excludes the report ID byte).
 */
export const parseReport = (reportId: number, data: DataView): ParsedReport => {
    const length = data.byteLength;

    switch (reportId) {
        case 1:
            if (length >= 12) {
                return {
                    kind: 'combined',
                    axes: {
                        tx: int16At(data, 0),
                        ty: int16At(data, 2),
                        tz: int16At(data, 4),
                        rx: int16At(data, 6),
                        ry: int16At(data, 8),
                        rz: int16At(data, 10)
                    }
                };
            }
            if (length >= 6) {
                return { kind: 'translation', tx: int16At(data, 0), ty: int16At(data, 2), tz: int16At(data, 4) };
            }
            break;
        case 2:
            if (length >= 6) {
                return { kind: 'rotation', rx: int16At(data, 0), ry: int16At(data, 2), rz: int16At(data, 4) };
            }
            break;
        case 3:
            if (length >= 4) {
                return { kind: 'buttons', mask: data.getUint32(0, true) >>> 0 };
            }
            if (length >= 1) {
                // some devices send fewer bytes; widen what we have
                let mask = 0;
                for (let i = 0; i < length; i++) {
                    mask |= data.getUint8(i) << (8 * i);
                }
                return { kind: 'buttons', mask: mask >>> 0 };
            }
            break;
        default:
            break;
    }

    return { kind: 'ignored', reportId, length };
};

/**
 * Parse a raw buffer whose first byte is the report ID (hidapi / Raw Input style).
 */
export const parseRawBuffer = (bytes: Uint8Array): ParsedReport => {
    if (bytes.length === 0) {
        return { kind: 'ignored', reportId: -1, length: 0 };
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + 1, bytes.byteLength - 1);
    return parseReport(bytes[0], view);
};

// SpaceMouse Pro (046D:C62B) button map, report 3. Valid mask 0x07C0F137; other bits are
// constant padding. Cross-verified against Blender, spacenavd and the HID descriptor.
export const SPACEMOUSE_PRO_VALID_MASK = 0x07c0f137;

export const SPACEMOUSE_PRO_BUTTONS = {
    MENU: 0,
    FIT: 1,
    TOP: 2,
    RIGHT: 4,
    FRONT: 5,
    ROLL_CW: 8,
    KEY_1: 12,
    KEY_2: 13,
    KEY_3: 14,
    KEY_4: 15,
    ESC: 22,
    ALT: 23,
    SHIFT: 24,
    CTRL: 25,
    ROTATE: 26
} as const;

export type SpaceMouseProButton = keyof typeof SPACEMOUSE_PRO_BUTTONS;

export const buttonBit = (button: SpaceMouseProButton) => 1 << SPACEMOUSE_PRO_BUTTONS[button];

export const buttonsFromMask = (mask: number): SpaceMouseProButton[] => {
    const valid = (mask & SPACEMOUSE_PRO_VALID_MASK) >>> 0;
    return (Object.keys(SPACEMOUSE_PRO_BUTTONS) as SpaceMouseProButton[]).filter(name => (valid & buttonBit(name)) !== 0);
};
