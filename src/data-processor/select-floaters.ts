import {
    BUFFERUSAGE_COPY_DST,
    BUFFERUSAGE_COPY_SRC,
    SHADERLANGUAGE_WGSL,
    SHADERSTAGE_COMPUTE,
    BindGroupFormat,
    BindStorageBufferFormat,
    BindUniformBufferFormat,
    Compute,
    GraphicsDevice,
    Shader,
    StorageBuffer,
    Vec2
} from 'playcanvas';

import { BufferPool } from './buffer-pool';
import { maskByteSize } from './histogram-config';
import {
    createSplatValueTextureFormats,
    createSplatValueUniformFormat,
    setSplatValueParameters,
    SplatValueOptions
} from './splat-value-compute';
import { computeSplatValueWGSL } from '../shaders/splat-value-shader';
import { Splat } from '../splat';

// [custom] Floater selection (user CR 2026-09-08). Floaters in a 3DGS capture
// are typically large and faint, so one pass ANDs the two histogram axes the
// user used to combine by hand: the largest scale axis (propMode 72) at or
// above minScale, and the final opacity (propMode 8, graded alpha included)
// at or below maxOpacity. Hidden / locked instances never match, and splats
// beyond the depth selection far plane are skipped like in the colour match.
// minScale and maxOpacity travel in the shared minValue / maxValue uniforms.
type FloaterParams = {
    minScale: number;
    maxOpacity: number;
};

type Variant = {
    compute: Compute;
    bindGroupFormat: BindGroupFormat;
};

const WORKGROUP_SIZE = 256;

class SelectFloaters {
    private readonly device: GraphicsDevice;
    private readonly variants = new Map<number, Variant>();
    private readonly dispatchSize = new Vec2();
    private output: StorageBuffer = null;

    constructor(device: GraphicsDevice) {
        this.device = device;
    }

    private getVariant(bands: number) {
        let variant = this.variants.get(bands);
        if (variant) return variant;

        const common = computeSplatValueWGSL(bands, 1);
        const uniforms = createSplatValueUniformFormat(this.device);
        const bindGroupFormat = new BindGroupFormat(this.device, [
            new BindStorageBufferFormat('result', SHADERSTAGE_COMPUTE),
            ...createSplatValueTextureFormats(bands),
            new BindUniformBufferFormat('uniforms', SHADERSTAGE_COMPUTE)
        ]);
        const shader = new Shader(this.device, {
            name: `SelectFloatersCompute-${bands}`,
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: /* wgsl */`
@group(0) @binding(0) var<storage, read_write> result: array<u32>;
${common.code}

fn isFloater(index: u32) -> bool {
    var s: SplatValue;
    if (!readSplat(index, &s) || !s.visible) { return false; }
    if (uniforms.depthFar > 0.0 && -(uniforms.viewMatrix * vec4f(s.worldPos, 1.0)).z > uniforms.depthFar) {
        return false;
    }
    let scale = textureLoad(transformB, s.uv, 0).xyz;
    let largest = max(scale.x, max(scale.y, scale.z));
    let opacity = textureLoad(splatColor, s.uv, 0).a * paletteGrade(s.colorIndex).alpha;
    return largest >= uniforms.minValue && opacity <= uniforms.maxValue;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) numWorkgroups: vec3u) {
    let word = gid.y * numWorkgroups.x * ${WORKGROUP_SIZE}u + gid.x;
    let first = word * 4u;
    if (first >= uniforms.numSplats) { return; }
    var packed = 0u;
    for (var channel = 0u; channel < 4u; channel++) {
        if (isFloater(first + channel)) { packed |= 0xffu << (channel * 8u); }
    }
    result[word] = packed;
}`,
            computeBindGroupFormat: bindGroupFormat,
            computeUniformBufferFormats: { uniforms }
        } as any);
        const compute = new Compute(this.device, shader, `SelectFloatersCompute-${bands}`);
        variant = { compute, bindGroupFormat };
        this.variants.set(bands, variant);
        return variant;
    }

    async run(splat: Splat, params: FloaterParams, options: SplatValueOptions, bufferPool: BufferPool): Promise<Uint8Array> {
        const count = splat.instances.count;
        const byteSize = maskByteSize(count);
        if (!this.output || this.output.byteSize !== byteSize) {
            this.output?.destroy();
            this.output = new StorageBuffer(this.device, byteSize, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);
        }

        const variant = this.getVariant(splat.resource.shBands);
        variant.compute.setParameter('result', this.output);
        setSplatValueParameters(variant.compute, splat, 0, options, params.minScale, params.maxOpacity);
        const words = byteSize / 4;
        Compute.calcDispatchSize(Math.ceil(words / WORKGROUP_SIZE), this.dispatchSize);
        variant.compute.setupDispatch(this.dispatchSize.x, this.dispatchSize.y);
        this.device.computeDispatch([variant.compute], 'select-floaters');
        const data = bufferPool.acquire(byteSize);
        const readback = this.output.read(0, byteSize, data, false);
        (this.device as any).submit();
        return await readback as Uint8Array;
    }
}

export { SelectFloaters };
export type { FloaterParams };
