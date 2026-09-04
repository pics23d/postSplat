import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clampDeltaTime, shape } from '../../src/spacemouse/curve';
import { buttonBit, buttonsFromMask, parseRawBuffer, parseReport, SPACEMOUSE_PRO_VALID_MASK } from '../../src/spacemouse/report-parser';
import { SpaceMouseState } from '../../src/spacemouse/state';

const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);
const int16le = (v: number) => [v & 0xff, (v >> 8) & 0xff];

describe('parseReport', () => {
    it('decodes a split translation report (id 1, 6 bytes) and normalizes by 350', () => {
        const r = parseReport(1, view(...int16le(350), ...int16le(-175), ...int16le(0)));
        assert.equal(r.kind, 'translation');
        if (r.kind === 'translation') {
            assert.equal(r.tx, 1);
            assert.equal(r.ty, -0.5);
            assert.equal(r.tz, 0);
        }
    });

    it('clamps overshoot beyond ±350 to ±1', () => {
        const r = parseReport(1, view(...int16le(512), ...int16le(-512), ...int16le(0)));
        assert.equal(r.kind, 'translation');
        if (r.kind === 'translation') {
            assert.equal(r.tx, 1);
            assert.equal(r.ty, -1);
        }
    });

    it('decodes a split rotation report (id 2)', () => {
        const r = parseReport(2, view(...int16le(-350), ...int16le(70), ...int16le(350)));
        assert.equal(r.kind, 'rotation');
        if (r.kind === 'rotation') {
            assert.equal(r.rx, -1);
            assert.equal(r.ry, 0.2);
            assert.equal(r.rz, 1);
        }
    });

    it('decodes a combined 12-byte report (id 1) used by wireless devices', () => {
        const r = parseReport(1, view(
            ...int16le(35), ...int16le(-35), ...int16le(70),
            ...int16le(-70), ...int16le(105), ...int16le(-105)
        ));
        assert.equal(r.kind, 'combined');
        if (r.kind === 'combined') {
            assert.deepEqual(r.axes, { tx: 0.1, ty: -0.1, tz: 0.2, rx: -0.2, ry: 0.3, rz: -0.3 });
        }
    });

    it('decodes the button mask (id 3) as an unsigned 32-bit word', () => {
        const r = parseReport(3, view(0x02, 0x00, 0x00, 0x00));
        assert.equal(r.kind, 'buttons');
        if (r.kind === 'buttons') {
            assert.equal(r.mask, buttonBit('FIT'));
            assert.deepEqual(buttonsFromMask(r.mask), ['FIT']);
        }
        const all = parseReport(3, view(0x37, 0xf1, 0xc0, 0x07));
        if (all.kind === 'buttons') {
            assert.equal(all.mask, SPACEMOUSE_PRO_VALID_MASK);
            assert.equal(buttonsFromMask(all.mask).length, 15);
        }
    });

    it('ignores unknown report ids (battery 0x17, the Pro collection also lists id 22)', () => {
        assert.equal(parseReport(0x17, view(0x64)).kind, 'ignored');
        assert.equal(parseReport(22, view(0, 0, 0)).kind, 'ignored');
        assert.equal(parseReport(1, view(0, 0)).kind, 'ignored');
    });

    it('parseRawBuffer splits off the leading report id byte', () => {
        const r = parseRawBuffer(Uint8Array.from([1, ...int16le(350), ...int16le(0), ...int16le(0)]));
        assert.equal(r.kind, 'translation');
        if (r.kind === 'translation') assert.equal(r.tx, 1);
        assert.equal(parseRawBuffer(new Uint8Array(0)).kind, 'ignored');
    });
});

describe('SpaceMouseState', () => {
    it('latches translation and rotation into one snapshot and reports activity', () => {
        const state = new SpaceMouseState(() => 0, 100);
        state.apply({ kind: 'translation', tx: 0.5, ty: 0, tz: 0 });
        state.apply({ kind: 'rotation', rx: 0, ry: 0, rz: -0.25 });
        const s = state.snapshot();
        assert.deepEqual(s.axes, { tx: 0.5, ty: 0, tz: 0, rx: 0, ry: 0, rz: -0.25 });
        assert.equal(s.active, true);
        assert.equal(s.rotating, true);
    });

    it('zeroes the axes after the TTL expires without reports', () => {
        let t = 0;
        const state = new SpaceMouseState(() => t, 100);
        state.apply({ kind: 'translation', tx: 1, ty: 0, tz: 0 });
        t = 50;
        assert.equal(state.snapshot().axes.tx, 1);
        t = 151;
        const s = state.snapshot();
        assert.equal(s.axes.tx, 0);
        assert.equal(s.active, false);
    });

    it('computes button edges once per snapshot', () => {
        const state = new SpaceMouseState(() => 0);
        state.apply({ kind: 'buttons', mask: buttonBit('FIT') });
        const first = state.snapshot();
        assert.equal(first.pressed, buttonBit('FIT'));
        assert.equal(first.released, 0);
        const second = state.snapshot();
        assert.equal(second.pressed, 0);
        state.apply({ kind: 'buttons', mask: 0 });
        const third = state.snapshot();
        assert.equal(third.released, buttonBit('FIT'));
    });

    it('clear() drops axes and pending button edges', () => {
        const state = new SpaceMouseState(() => 0);
        state.apply({ kind: 'translation', tx: 1, ty: 1, tz: 1 });
        state.apply({ kind: 'buttons', mask: buttonBit('MENU') });
        state.clear();
        const s = state.snapshot();
        assert.equal(s.active, false);
        assert.equal(s.pressed, 0);
        assert.equal(s.ageMs, Infinity);
    });
});

describe('curve', () => {
    it('shape() is zero inside the deadzone, monotonic, odd, and reaches ±1', () => {
        assert.equal(shape(0.02, 0.03, 1.75), 0);
        assert.equal(shape(-0.02, 0.03, 1.75), 0);
        assert.equal(shape(1, 0.03, 1.75), 1);
        assert.equal(shape(-1, 0.03, 1.75), -1);
        const a = shape(0.3, 0.03, 1.75);
        const b = shape(0.6, 0.03, 1.75);
        assert.ok(a > 0 && b > a);
        assert.equal(shape(-0.3, 0.03, 1.75), -a);
    });

    it('clampDeltaTime bounds stalls and rejects non-positive values', () => {
        assert.equal(clampDeltaTime(0.016), 0.016);
        assert.equal(clampDeltaTime(2.5), 0.1);
        assert.equal(clampDeltaTime(NaN), 0);
        assert.equal(clampDeltaTime(-1), 0);
    });
});
