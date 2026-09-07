import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { oklabDistance, quantizeColors, rgbToOklab, Rgb } from '../../src/tools/color-quantize';

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

describe('rgbToOklab', () => {
    it('matches the reference values for white and pure red', () => {
        const white = rgbToOklab([1, 1, 1]);
        assert.ok(near(white[0], 1) && near(white[1], 0) && near(white[2], 0), `white -> ${white}`);
        const red = rgbToOklab([1, 0, 0]);
        assert.ok(near(red[0], 0.628) && near(red[1], 0.225) && near(red[2], 0.126), `red -> ${red}`);
    });
});

describe('quantizeColors', () => {
    const jitter = (c: Rgb, i: number): Rgb => [c[0] + 0.01 * (i % 3), c[1] - 0.01 * (i % 2), c[2] + 0.005 * (i % 5)];

    it('collapses a stroke over three colours into three references, largest first', () => {
        const sky: Rgb = [0.42, 0.59, 0.77];
        const leaf: Rgb = [0.35, 0.45, 0.25];
        const bark: Rgb = [0.25, 0.2, 0.15];
        const samples: Rgb[] = [];
        for (let i = 0; i < 60; i++) samples.push(jitter(sky, i));
        for (let i = 0; i < 25; i++) samples.push(jitter(leaf, i));
        for (let i = 0; i < 10; i++) samples.push(jitter(bark, i));

        const refs = quantizeColors(samples, 16);
        assert.equal(refs.length, 3);
        assert.ok(oklabDistance(refs[0], sky) < 0.03, 'largest cluster is the sky');
        assert.ok(oklabDistance(refs[1], leaf) < 0.03);
        assert.ok(oklabDistance(refs[2], bark) < 0.03);
    });

    it('drops clusters below the minimum share', () => {
        const colors: Rgb[] = [];
        for (let i = 0; i < 97; i++) colors.push(jitter([0.5, 0.7, 0.9], i));
        for (let i = 0; i < 3; i++) colors.push(jitter([0.5, 0.6, 0.4], i));
        assert.equal(quantizeColors(colors, 16).length, 2);
        assert.equal(quantizeColors(colors, 16, 0.05, 0.05).length, 1);
        assert.equal(quantizeColors([], 16, 0.05, 0.05).length, 0);
    });

    it('keeps at most maxCount references and none for zero', () => {
        const samples: Rgb[] = Array.from({ length: 40 }, (_, i) => [i / 40, 0.5, 1 - i / 40]);
        assert.equal(quantizeColors(samples, 4).length, 4);
        assert.equal(quantizeColors(samples, 0).length, 0);
        assert.equal(quantizeColors([], 4).length, 0);
    });

    it('a wider merge distance yields fewer references', () => {
        const samples: Rgb[] = Array.from({ length: 40 }, (_, i) => [i / 40, 0.5, 1 - i / 40]);
        assert.ok(quantizeColors(samples, 16, 0.2).length < quantizeColors(samples, 16, 0.05).length);
    });
});
