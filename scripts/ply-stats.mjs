// [custom] Headless statistics for a 3DGS PLY: colour / opacity / size
// distributions, plus how well a colour cluster (default: sky blue) separates
// from the rest under the eyedropper's metrics. Used to reason about colour
// selection before touching the tool (M4).
//
// usage: node scripts/ply-stats.mjs <file.ply> [--hue 190-240] [--sat 0.05-0.7] [--val 0.45-1]

import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) {
    console.error('usage: node scripts/ply-stats.mjs <file.ply> [--hue lo-hi] [--sat lo-hi] [--val lo-hi]');
    process.exit(2);
}
const range = (name, fallback) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    return args[i + 1].split('-').map(Number);
};
const hueRange = range('--hue', [190, 240]);
const satRange = range('--sat', [0.05, 0.7]);
const valRange = range('--val', [0.45, 1]);

// ---- parse (binary little endian, float32 vertex props only) ----
const buffer = fs.readFileSync(file);
const headerEnd = buffer.indexOf('end_header\n') + 'end_header\n'.length;
const header = buffer.subarray(0, headerEnd).toString('ascii').split('\n');
const count = Number(header.find(l => l.startsWith('element vertex')).split(' ')[2]);
const props = header.filter(l => l.startsWith('property')).map(l => l.split(' ')[2]);
const types = header.filter(l => l.startsWith('property')).map(l => l.split(' ')[1]);
if (types.some(t => t !== 'float')) {
    console.error('only float32 properties are supported');
    process.exit(1);
}
const stride = props.length * 4;
const view = new DataView(buffer.buffer, buffer.byteOffset + headerEnd);
const col = name => props.indexOf(name);
const read = (i, p) => view.getFloat32(i * stride + p * 4, true);

const SH_C0 = 0.28209479177387814;
const sigmoid = x => 1 / (1 + Math.exp(-x));
const clamp01 = v => Math.min(1, Math.max(0, v));

const rgbToHsv = (r, g, b) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
    }
    return [h, max > 0 ? d / max : 0, max];
};
const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgbToOklab = (r, g, b) => {
    r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
};

const splats = [];
for (let i = 0; i < count; i++) {
    const r = clamp01(0.5 + SH_C0 * read(i, col('f_dc_0')));
    const g = clamp01(0.5 + SH_C0 * read(i, col('f_dc_1')));
    const b = clamp01(0.5 + SH_C0 * read(i, col('f_dc_2')));
    const opacity = sigmoid(read(i, col('opacity')));
    const sx = Math.exp(read(i, col('scale_0'))), sy = Math.exp(read(i, col('scale_1'))), sz = Math.exp(read(i, col('scale_2')));
    const [h, s, v] = rgbToHsv(r, g, b);
    splats.push({
        x: read(i, col('x')), y: read(i, col('y')), z: read(i, col('z')),
        r, g, b, h, s, v, opacity,
        size: Math.cbrt(sx * sy * sz), maxScale: Math.max(sx, sy, sz),
        lab: rgbToOklab(r, g, b)
    });
}

const pct = (n, total = count) => `${n} (${(100 * n / total).toFixed(1)}%)`;
const quantiles = (values, qs = [0.1, 0.5, 0.9]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return qs.map(q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(3)).join(' / ');
};
const histogram = (values, edges) => edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    return `${lo}-${hi}: ${pct(values.filter(v => v >= lo && v < hi).length)}`;
}).join('\n  ');

console.log(`${file}: ${count} splats, props ${props.join(' ')}`);

console.log('\nopacity (p10/p50/p90):', quantiles(splats.map(s => s.opacity)));
console.log('  ' + histogram(splats.map(s => s.opacity), [0, 0.05, 0.15, 0.3, 0.5, 0.8, 1.01]));
console.log('size = cbrt(sx*sy*sz) (p10/p50/p90):', quantiles(splats.map(s => s.size)));

console.log('\nhue histogram (saturation > 0.08):');
const saturated = splats.filter(s => s.s > 0.08);
console.log('  ' + histogram(saturated.map(s => s.h), [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]).replace(/\(([\d.]+)%\)/g, (m, p) => `(${p}% of saturated)`));
console.log(`  unsaturated (s <= 0.08): ${pct(count - saturated.length)}`);

// ---- the target cluster ----
const inRange = (v, [lo, hi]) => v >= lo && v <= hi;
const isTarget = s => inRange(s.h, hueRange) && inRange(s.s, satRange) && inRange(s.v, valRange);
const target = splats.filter(isTarget);
const rest = splats.filter(s => !isTarget(s));
console.log(`\ntarget cluster hue ${hueRange.join('-')} sat ${satRange.join('-')} val ${valRange.join('-')}: ${pct(target.length)}`);
if (target.length) {
    console.log('  opacity p10/p50/p90:', quantiles(target.map(s => s.opacity)));
    console.log('  size p10/p50/p90:', quantiles(target.map(s => s.size)), ' rest:', quantiles(rest.map(s => s.size)));
    console.log('  mean rgb:', ['r', 'g', 'b'].map(c => (target.reduce((a, s) => a + s[c], 0) / target.length).toFixed(3)).join(' '));
    const mean = [0, 1, 2].map(i => target.reduce((a, s) => a + s.lab[i], 0) / target.length);
    const dist = s => Math.hypot(s.lab[0] - mean[0], s.lab[1] - mean[1], s.lab[2] - mean[2]);
    console.log('  OKLab tolerance around the cluster mean -> target captured / others swept in:');
    for (const tol of [0.05, 0.08, 0.1, 0.15, 0.2, 0.3]) {
        const hit = target.filter(s => dist(s) <= tol).length;
        const swept = rest.filter(s => dist(s) <= tol).length;
        console.log(`    ${tol.toFixed(2)}: ${pct(hit, target.length)} target, ${pct(swept, rest.length)} of the rest`);
    }
    // what the rest within reach looks like
    const near = rest.filter(s => dist(s) <= 0.15);
    if (near.length) {
        console.log(`  the rest within 0.15: opacity p10/p50/p90 ${quantiles(near.map(s => s.opacity))}, sat ${quantiles(near.map(s => s.s))}, val ${quantiles(near.map(s => s.v))}, hue ${quantiles(near.map(s => s.h))}`);
    }
    // faint veils: low-opacity splats, their colour relative to the target
    const faint = splats.filter(s => s.opacity < 0.15);
    console.log(`\nfaint splats (opacity < 0.15): ${pct(faint.length)}; within OKLab 0.15 of the target mean: ${pct(faint.filter(s => dist(s) <= 0.15).length, faint.length)}; size p50 ${quantiles(faint.map(s => s.size), [0.5])} vs all ${quantiles(splats.map(s => s.size), [0.5])}`);
    console.log(`  faint & large (size > p75 of all): ${pct(faint.filter(s => s.size > Number(quantiles(splats.map(x => x.size), [0.75]))).length, faint.length)}`);
}

// per-target-splat: what fraction of the target's own members sit near the cluster in the other metrics
console.log('\ntarget cluster hue/sat/val p10/p50/p90:');
console.log('  hue', quantiles(target.map(s => s.h)), ' sat', quantiles(target.map(s => s.s)), ' val', quantiles(target.map(s => s.v)));
console.log('rest hue/sat/val p10/p50/p90:');
console.log('  hue', quantiles(rest.map(s => s.h)), ' sat', quantiles(rest.map(s => s.s)), ' val', quantiles(rest.map(s => s.v)));
