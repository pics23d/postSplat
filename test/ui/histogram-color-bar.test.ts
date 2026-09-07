import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { axisColor, axisValueOf, chromaGainFor, isColorAxisMode, oklabToRgb, rgbToHsv, rgbToOklab, Rgb } from '../../src/ui/histogram-color-bar';

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

describe('isColorAxisMode', () => {
    it('covers the final colour, HSV, OKLab and raw DC modes only', () => {
        for (const mode of [5, 6, 7, 18, 19, 20, 66, 67, 68, 69, 70, 71]) {
            assert.ok(isColorAxisMode(mode), `mode ${mode}`);
        }
        for (const mode of [0, 3, 4, 8, 12, 17, 21, 65, 72]) {
            assert.ok(!isColorAxisMode(mode), `mode ${mode}`);
        }
    });
});

describe('axisValueOf', () => {
    it('mirrors the histogram kernel for a known colour', () => {
        const c: Rgb = [0.2, 0.6, 0.9];
        assert.ok(near(axisValueOf(5, c), 0.2) && near(axisValueOf(6, c), 0.6) && near(axisValueOf(7, c), 0.9));
        // hue in degrees, saturation and value as fractions
        assert.ok(near(axisValueOf(18, c), 205.714, 0.01), `hue ${axisValueOf(18, c)}`);
        assert.ok(near(axisValueOf(19, c), 0.7778) && near(axisValueOf(20, c), 0.9));
        // raw DC: (c - 0.5) / SH_C0
        assert.ok(near(axisValueOf(66, c), -1.0635, 1e-3), `dc ${axisValueOf(66, c)}`);
        const lab = rgbToOklab(c);
        assert.ok(near(axisValueOf(69, c), lab[0]) && near(axisValueOf(70, c), lab[1]) && near(axisValueOf(71, c), lab[2]));
        assert.equal(axisValueOf(3, c), undefined);
    });

    it('gives grey a hue of zero like the shader', () => {
        assert.equal(axisValueOf(18, [0.5, 0.5, 0.5]), 0);
        assert.equal(rgbToHsv([0, 0, 0])[1], 0);
    });
});

describe('axisColor', () => {
    it('round-trips: the colour drawn for a value measures as that value', () => {
        const cases: [number, number][] = [
            [5, 0.3], [7, 0.8], [18, 30], [18, 200], [18, 340], [19, 0.4], [20, 0.65],
            [66, -1.2], [68, 1.5], [69, 0.3], [69, 0.8], [70, -0.1], [70, 0.12], [71, -0.15], [71, 0.1]
        ];
        for (const [mode, value] of cases) {
            const back = axisValueOf(mode, axisColor(mode, value, 0.6));
            assert.ok(near(back, value, mode === 18 ? 0.5 : 5e-3), `mode ${mode}: ${value} -> ${back}`);
        }
    });

    it('stretches a narrow OKLab a / b range to a vivid ramp', () => {
        // the tree spans about ±0.09 on a: the ends read as grey at gain 1
        const gain = chromaGainFor(-0.085, 0.091);
        assert.ok(near(gain, 0.25 / 0.091, 1e-3), `gain ${gain}`);
        assert.equal(chromaGainFor(-0.4, 0.3), 1);
        assert.equal(chromaGainFor(0, 0), 1);
        const [, , b] = axisColor(71, -0.09, 0, gain);   // b negative = blue end
        const [, , bFlat] = axisColor(71, -0.09, 0, 1);
        assert.ok(b > bFlat, `gain makes the blue end bluer: ${b} vs ${bFlat}`);
        assert.ok(near(axisValueOf(71, axisColor(71, -0.09, 0, 1)), -0.09, 5e-3));
    });

    it('uses the reference hue for the saturation ramp', () => {
        const c = axisColor(19, 1, 0.6);
        assert.ok(near(rgbToHsv(c)[0], 0.6));
    });
});

describe('oklabToRgb', () => {
    it('inverts rgbToOklab inside the gamut', () => {
        for (const c of [[0.1, 0.2, 0.3], [0.9, 0.5, 0.2], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0, 0]] as Rgb[]) {
            const back = oklabToRgb(...rgbToOklab(c));
            assert.ok(near(back[0], c[0]) && near(back[1], c[1]) && near(back[2], c[2]), `${c} -> ${back}`);
        }
    });
});
