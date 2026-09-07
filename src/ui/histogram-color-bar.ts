// [custom] Colour ramp and reference markers under the Splat Data histogram (M4).
//
// For the colour properties (final colour channels, HSV, OKLab, raw DC) the
// histogram axis is a colour quantity, so a continuous bar beneath it shows
// which colour every position stands for, and the eyedropper's reference
// colours (the chips) are placed on that axis as markers. Pure helpers here
// (unit-tested); the drawing lives in data-panel.ts. The conversions mirror
// src/shaders/splat-value-shader.ts so a chip lands where the splats of that
// colour are binned.

type Rgb = [number, number, number];

// gpu propModes of the colour axes (see PROP_MODE in data-panel.ts)
const MODE_RED = 5;
const MODE_HUE = 18;
const MODE_SATURATION = 19;
const MODE_VALUE = 20;
const MODE_F_DC = 66;
const MODE_OKLAB_L = 69;

// SH band-0 constant: f_dc = (colour - 0.5) / SH_C0
const SH_C0 = 0.28209479177387814;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const rgbToOklab = ([r, g, b]: Rgb): [number, number, number] => {
    const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
};

// inverse of rgbToOklab, clamped to the sRGB gamut
const oklabToRgb = (L: number, a: number, b: number): Rgb => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    return [
        clamp01(linearToSrgb(clamp01(lr))),
        clamp01(linearToSrgb(clamp01(lg))),
        clamp01(linearToSrgb(clamp01(lb)))
    ];
};

// hue in [0, 1), saturation and value in [0, 1]; grey has hue 0 like the shader
const rgbToHsv = ([r, g, b]: Rgb): [number, number, number] => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 1e-10) {
        if (max === r) {
            h = ((g - b) / d) / 6;
        } else if (max === g) {
            h = (2 + (b - r) / d) / 6;
        } else {
            h = (4 + (r - g) / d) / 6;
        }
        if (h < 0) h += 1;
    }
    return [h, max > 1e-10 ? d / max : 0, max];
};

const hsvToRgb = (h: number, s: number, v: number): Rgb => {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (((i % 6) + 6) % 6) {
        case 0: return [v, t, p];
        case 1: return [q, v, p];
        case 2: return [p, v, t];
        case 3: return [p, q, v];
        case 4: return [t, p, v];
        default: return [v, p, q];
    }
};

// does this propMode measure a colour (and therefore get a bar)?
const isColorAxisMode = (mode: number) => {
    return (mode >= MODE_RED && mode <= MODE_RED + 2) ||
        (mode >= MODE_HUE && mode <= MODE_VALUE) ||
        (mode >= MODE_F_DC && mode <= MODE_F_DC + 2) ||
        (mode >= MODE_OKLAB_L && mode <= MODE_OKLAB_L + 2);
};

// the value the histogram kernel computes for a splat of this (final) colour;
// undefined for non-colour axes
const axisValueOf = (mode: number, color: Rgb): number | undefined => {
    const c: Rgb = [clamp01(color[0]), clamp01(color[1]), clamp01(color[2])];
    if (mode >= MODE_RED && mode <= MODE_RED + 2) {
        return c[mode - MODE_RED];
    }
    if (mode >= MODE_HUE && mode <= MODE_VALUE) {
        const hsv = rgbToHsv(c);
        return mode === MODE_HUE ? hsv[0] * 360 : hsv[mode - MODE_HUE];
    }
    if (mode >= MODE_F_DC && mode <= MODE_F_DC + 2) {
        return (c[mode - MODE_F_DC] - 0.5) / SH_C0;
    }
    if (mode >= MODE_OKLAB_L && mode <= MODE_OKLAB_L + 2) {
        return rgbToOklab(c)[mode - MODE_OKLAB_L];
    }
    return undefined;
};

// the colour that stands for `value` on this axis. The other components are
// fixed at something legible: full saturation and value for the hue ramp, the
// reference hue (first chip, else red) for the saturation ramp, a mid
// lightness for the OKLab a / b ramps, black for the remaining channels.
// chromaGain stretches the OKLab a / b ramps: natural scenes span only about
// ±0.1 there, which reads as grey, so the caller scales the visible range up
// to a vivid chroma (the direction green ↔ red / blue ↔ yellow is what the bar
// has to show; the marker positions are unaffected).
const axisColor = (mode: number, value: number, referenceHue = 0, chromaGain = 1): Rgb => {
    if (mode >= MODE_RED && mode <= MODE_RED + 2) {
        const c: Rgb = [0, 0, 0];
        c[mode - MODE_RED] = clamp01(value);
        return c;
    }
    if (mode === MODE_HUE) {
        return hsvToRgb(((value / 360) % 1 + 1) % 1, 1, 1);
    }
    if (mode === MODE_SATURATION) {
        return hsvToRgb(referenceHue, clamp01(value), 1);
    }
    if (mode === MODE_VALUE) {
        const v = clamp01(value);
        return [v, v, v];
    }
    if (mode >= MODE_F_DC && mode <= MODE_F_DC + 2) {
        const c: Rgb = [0, 0, 0];
        c[mode - MODE_F_DC] = clamp01(0.5 + value * SH_C0);
        return c;
    }
    if (mode === MODE_OKLAB_L) {
        return oklabToRgb(clamp01(value), 0, 0);
    }
    if (mode === MODE_OKLAB_L + 1) {
        return oklabToRgb(0.72, value * chromaGain, 0);
    }
    if (mode === MODE_OKLAB_L + 2) {
        return oklabToRgb(0.72, 0, value * chromaGain);
    }
    return [0, 0, 0];
};

// the gain that brings the larger end of an OKLab a / b range to a vivid
// chroma of 0.25 (never below 1, never above 8 for near-grey scenes)
const VIVID_CHROMA = 0.25;
const chromaGainFor = (min: number, max: number) => {
    const extent = Math.max(Math.abs(min), Math.abs(max));
    return extent > 0 ? Math.min(8, Math.max(1, VIVID_CHROMA / extent)) : 1;
};

export { isColorAxisMode, axisValueOf, axisColor, chromaGainFor, rgbToHsv, hsvToRgb, rgbToOklab, oklabToRgb };
export type { Rgb };
