// [custom] Generate small synthetic 3DGS PLY fixtures for tests and headless checks.
//
// usage: node scripts/make-fixtures.mjs [outDir]   (default: test/fixtures)
//
// Fixtures (standard 3DGS binary_little_endian PLY: x y z nx ny nz f_dc_0..2
// opacity scale_0..2 rot_0..3):
//   two-planes.ply     two parallel XY planes of splats at z=0 (front, red) and
//                      z=-2 (back, blue), 64x64 each. Depth-band brush check:
//                      a stroke over the front plane must select only front splats.
//   color-clusters.ply four spatially separated clusters with distinct colors
//                      (2000 splats each). Color-selection check: selecting by
//                      one cluster's color must select exactly its count.

import fs from 'node:fs';
import path from 'node:path';

const SH_C0 = 0.28209479177387814;
const dcEncode = v => (v - 0.5) / SH_C0;
const inverseSigmoid = v => Math.log(v / (1 - v));

const PROPS = [
    'x', 'y', 'z', 'nx', 'ny', 'nz',
    'f_dc_0', 'f_dc_1', 'f_dc_2',
    'opacity',
    'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3'
];

const writePly = (file, splats) => {
    const header = [
        'ply',
        'format binary_little_endian 1.0',
        `element vertex ${splats.length}`,
        ...PROPS.map(p => `property float ${p}`),
        'end_header',
        ''
    ].join('\n');

    const body = new Float32Array(splats.length * PROPS.length);
    splats.forEach((s, i) => {
        const o = i * PROPS.length;
        body[o + 0] = s.x; body[o + 1] = s.y; body[o + 2] = s.z;
        body[o + 3] = 0; body[o + 4] = 0; body[o + 5] = 0;
        body[o + 6] = dcEncode(s.r); body[o + 7] = dcEncode(s.g); body[o + 8] = dcEncode(s.b);
        body[o + 9] = inverseSigmoid(s.opacity ?? 0.9);
        const ls = Math.log(s.size ?? 0.02);
        body[o + 10] = ls; body[o + 11] = ls; body[o + 12] = ls;
        body[o + 13] = 1; body[o + 14] = 0; body[o + 15] = 0; body[o + 16] = 0;
    });

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(body.buffer)]));
    return splats.length;
};

// deterministic pseudo-random (mulberry32)
const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const twoPlanes = () => {
    const splats = [];
    const n = 64;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1) - 0.5) * 2;
            const y = (j / (n - 1) - 0.5) * 2;
            splats.push({ x, y, z: 0, r: 0.9, g: 0.2, b: 0.2, size: 0.03 });   // front, red
            splats.push({ x, y, z: -2, r: 0.2, g: 0.3, b: 0.9, size: 0.03 });  // back, blue
        }
    }
    return splats;
};

const colorClusters = () => {
    const rand = rng(1234);
    const clusters = [
        { c: [-1.5, 0, 0], color: [0.9, 0.1, 0.1] },
        { c: [1.5, 0, 0], color: [0.1, 0.8, 0.2] },
        { c: [0, 1.5, 0], color: [0.2, 0.3, 0.9] },
        { c: [0, -1.5, 0], color: [0.9, 0.8, 0.1] }
    ];
    const splats = [];
    for (const { c, color } of clusters) {
        for (let i = 0; i < 2000; i++) {
            splats.push({
                x: c[0] + (rand() - 0.5) * 0.8,
                y: c[1] + (rand() - 0.5) * 0.8,
                z: c[2] + (rand() - 0.5) * 0.8,
                r: color[0], g: color[1], b: color[2],
                size: 0.02
            });
        }
    }
    return splats;
};

const outDir = process.argv[2] ?? path.join('test', 'fixtures');
const results = {
    'two-planes.ply': writePly(path.join(outDir, 'two-planes.ply'), twoPlanes()),
    'color-clusters.ply': writePly(path.join(outDir, 'color-clusters.ply'), colorClusters())
};
console.log(JSON.stringify({ outDir, splatCounts: results }, null, 2));
