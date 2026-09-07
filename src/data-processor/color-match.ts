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

type Variant = {
    compute: Compute;
    bindGroupFormat: BindGroupFormat;
};

// [custom] colour selection (M4): a splat matches when its final colour lies
// within `tolerance` of any reference colour under the chosen metric.
// metric: 0 = RGB per channel (largest channel difference), 1 = HSV (weighted,
// hue wraps and fades with saturation), 2 = OKLab (perceptual ΔE).
type ColorMatchParams = {
    metric: number;
    tolerance: number;
    // HSV term weights (hue, saturation, value); default 1 / 1 / 1
    hsvWeights?: [number, number, number];
};

const MAX_REFS = 16;
const WORKGROUP_SIZE = 256;

class ColorMatch {
    private readonly device: GraphicsDevice;
    private readonly variants = new Map<number, Variant>();
    private readonly dispatchSize = new Vec2();
    private output: StorageBuffer = null;
    private refs: StorageBuffer;
    private refData = new Float32Array(MAX_REFS * 4);

    constructor(device: GraphicsDevice) {
        this.device = device;
        this.refs = new StorageBuffer(device, MAX_REFS * 16, BUFFERUSAGE_COPY_DST);
    }

    private getVariant(bands: number) {
        let variant = this.variants.get(bands);
        if (variant) return variant;

        const common = computeSplatValueWGSL(bands, 1);
        const uniforms = createSplatValueUniformFormat(this.device);
        const bindGroupFormat = new BindGroupFormat(this.device, [
            new BindStorageBufferFormat('result', SHADERSTAGE_COMPUTE),
            ...createSplatValueTextureFormats(bands),
            new BindUniformBufferFormat('uniforms', SHADERSTAGE_COMPUTE),
            new BindStorageBufferFormat('colorRefs', SHADERSTAGE_COMPUTE, true)
        ]);
        const shader = new Shader(this.device, {
            name: `ColorMatchCompute-${bands}`,
            shaderLanguage: SHADERLANGUAGE_WGSL,
            cshader: /* wgsl */`
@group(0) @binding(0) var<storage, read_write> result: array<u32>;
${common.code}
// reference display colours (rgb, unused w)
@group(0) @binding(${common.uniformBinding + 1}) var<storage, read> colorRefs: array<vec4f>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) numWorkgroups: vec3u) {
    let word = gid.y * numWorkgroups.x * ${WORKGROUP_SIZE}u + gid.x;
    let first = word * 4u;
    if (first >= uniforms.numSplats) { return; }

    let refCount = min(uniforms.colorRefCount, ${MAX_REFS}u);
    if (refCount == 0u) {
        result[word] = 0u;
        return;
    }
    var refs: array<vec3f, ${MAX_REFS}>;
    for (var i = 0u; i < refCount; i++) {
        refs[i] = colorMetricSpace(clamp(colorRefs[i].rgb, vec3f(0.0), vec3f(1.0)));
    }

    var packed = 0u;
    for (var channel = 0u; channel < 4u; channel++) {
        var splat: SplatValue;
        if (readSplat(first + channel, &splat)) {
            // beyond the depth selection far plane: never selected
            if (uniforms.depthFar > 0.0 && -(uniforms.viewMatrix * vec4f(splat.worldPos, 1.0)).z > uniforms.depthFar) {
                continue;
            }
            let color = colorMetricSpace(clamp(readFinalColor(splat), vec3f(0.0), vec3f(1.0)));
            for (var i = 0u; i < refCount; i++) {
                if (colorMetricDistance(color, refs[i]) <= uniforms.colorMatchThreshold) {
                    packed |= 0xffu << (channel * 8u);
                    break;
                }
            }
        }
    }
    result[word] = packed;
}`,
            computeBindGroupFormat: bindGroupFormat,
            computeUniformBufferFormats: { uniforms }
        } as any);
        const compute = new Compute(this.device, shader, `ColorMatchCompute-${bands}`);
        variant = { compute, bindGroupFormat };
        this.variants.set(bands, variant);
        return variant;
    }

    // refs: display colours as rgb triples (the first MAX_REFS are used)
    async run(splat: Splat, refs: Float32Array, params: ColorMatchParams, options: SplatValueOptions, bufferPool: BufferPool): Promise<Uint8Array> {
        const count = splat.instances.count;
        const byteSize = maskByteSize(count);
        if (!this.output || this.output.byteSize !== byteSize) {
            this.output?.destroy();
            this.output = new StorageBuffer(this.device, byteSize, BUFFERUSAGE_COPY_DST | BUFFERUSAGE_COPY_SRC);
        }

        const refCount = Math.min(MAX_REFS, Math.floor(refs.length / 3));
        this.refData.fill(0);
        for (let i = 0; i < refCount; i++) {
            this.refData[i * 4] = refs[i * 3];
            this.refData[i * 4 + 1] = refs[i * 3 + 1];
            this.refData[i * 4 + 2] = refs[i * 3 + 2];
        }
        this.refs.write(0, this.refData, 0, this.refData.length);

        const weights = params.hsvWeights ?? [1, 1, 1];
        const variant = this.getVariant(splat.resource.shBands);
        variant.compute.setParameter('result', this.output);
        setSplatValueParameters(variant.compute, splat, 0, options);
        variant.compute.setParameter('colorRefs', this.refs);
        variant.compute.setParameter('colorMatchThreshold', Math.max(0, params.tolerance));
        variant.compute.setParameter('colorMetric', params.metric);
        variant.compute.setParameter('colorRefCount', refCount);
        variant.compute.setParameter('hsvWeightH', weights[0]);
        variant.compute.setParameter('hsvWeightS', weights[1]);
        variant.compute.setParameter('hsvWeightV', weights[2]);
        const words = byteSize / 4;
        Compute.calcDispatchSize(Math.ceil(words / WORKGROUP_SIZE), this.dispatchSize);
        variant.compute.setupDispatch(this.dispatchSize.x, this.dispatchSize.y);
        this.device.computeDispatch([variant.compute], 'color-match');
        const data = bufferPool.acquire(byteSize);
        const readback = this.output.read(0, byteSize, data, false);
        (this.device as any).submit();
        return await readback as Uint8Array;
    }
}

export { ColorMatch, MAX_REFS };
export type { ColorMatchParams };
