// [custom] Skybox pass: a fullscreen quad that looks up an equirectangular
// image along each pixel's world-space view ray. Runs first in the world
// layer, straight after the clear, so the grid, the splats and every overlay
// composite over it. The direction → uv mapping is the engine's own
// (toSphericalUv in its envAtlas chunk), so the preview turns the same way as
// the published viewer's sky.

const vertexShader = /* wgsl */`
attribute vertex_position: vec2f;
varying ndc: vec2f;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4f(input.vertex_position, 0.0, 1.0);
    output.ndc = input.vertex_position;
    return output;
}
`;

const fragmentShader = /* wgsl */`
// inverse of a perspective view-projection (gl clip convention, z in -1..1)
uniform sky_invViewProjection: mat4x4f;
// 0 linear, 1 neutral, 2 aces, 3 aces2, 4 filmic, 5 hejl - the camera's tone
// mapping, applied like the splat shader applies it to gamma-space colours
uniform sky_tonemap: i32;
uniform sky_exposure: f32;
uniform sky_textureSize: vec2f;

var sky_texture: texture_2d<f32>;
var sky_texture_sampler: sampler;

varying ndc: vec2f;

const PI: f32 = 3.141592653589793;

fn toSphericalUv(dir: vec3f) -> vec2f {
    let angleXZ = select(0.0, atan2(dir.x, dir.z), any(dir.xz != vec2f(0.0)));
    let uv = vec2f(angleXZ, asin(dir.y)) / vec2f(PI * 2.0, PI) + vec2f(0.5, 0.5);
    return vec2f(uv.x, 1.0 - uv.y);
}

fn unproject(p: vec3f) -> vec3f {
    let h = uniform.sky_invViewProjection * vec4f(p, 1.0);
    return h.xyz / h.w;
}

// engine tone mapping chunks (playcanvas tonemapping*PS), one per mode
fn toneMapAces(color: vec3f) -> vec3f {
    let x = color;
    return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
}

const ACESInputMat: mat3x3f = mat3x3f(
    vec3f(0.59719, 0.35458, 0.04823),
    vec3f(0.07600, 0.90834, 0.01566),
    vec3f(0.02840, 0.13383, 0.83777)
);
const ACESOutputMat: mat3x3f = mat3x3f(
    vec3f( 1.60475, -0.53108, -0.07367),
    vec3f(-0.10208,  1.10813, -0.00605),
    vec3f(-0.00327, -0.07276,  1.07602)
);

fn toneMapAces2(color: vec3f) -> vec3f {
    var c = (color / 0.6) * ACESInputMat;
    let a = c * (c + vec3f(0.0245786)) - vec3f(0.000090537);
    let b = c * (vec3f(0.983729) * c + vec3f(0.4329510)) + vec3f(0.238081);
    c = (a / b) * ACESOutputMat;
    return clamp(c, vec3f(0.0), vec3f(1.0));
}

fn uncharted2(x: vec3f) -> vec3f {
    let A = 0.15; let B = 0.50; let C = 0.10; let D = 0.20; let E = 0.02; let F = 0.30;
    return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - vec3f(E / F);
}

fn toneMapFilmic(color: vec3f) -> vec3f {
    let W = 11.2;
    return uncharted2(color) * (vec3f(1.0) / uncharted2(vec3f(W)));
}

fn toneMapHejl(color: vec3f) -> vec3f {
    let A = 0.22; let B = 0.3; let C = 0.1; let D = 0.2; let E = 0.01; let F = 0.3; let Scl = 1.25;
    let h = max(vec3f(0.0), color - vec3f(0.004));
    return (h * ((Scl * A) * h + Scl * vec3f(C * B)) + Scl * vec3f(D * E)) /
        (h * (A * h + vec3f(B)) + vec3f(D * F)) - Scl * vec3f(E / F);
}

fn toneMapNeutral(col: vec3f) -> vec3f {
    var color = col;
    let startCompression = 0.8 - 0.04;
    let desaturation = 0.15;
    let x = min(color.r, min(color.g, color.b));
    let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
    color -= vec3f(offset);
    let peak = max(color.r, max(color.g, color.b));
    if (peak < startCompression) {
        return color;
    }
    let d = 1.0 - startCompression;
    let newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;
    let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3f(newPeak), vec3f(g));
}

fn toneMap(color: vec3f) -> vec3f {
    let exposed = color * uniform.sky_exposure;
    switch (uniform.sky_tonemap) {
        case 1: { return toneMapNeutral(exposed); }
        case 2: { return toneMapAces(exposed); }
        case 3: { return toneMapAces2(exposed); }
        case 4: { return toneMapFilmic(exposed); }
        case 5: { return toneMapHejl(exposed); }
        default: { return exposed; }
    }
}

@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;

    // world-space ray through this pixel
    let near = unproject(vec3f(input.ndc, -1.0));
    let far = unproject(vec3f(input.ndc, 1.0));
    let dir = normalize(far - near);

    let uv = toSphericalUv(dir);

    // pick the mip from the ray's angular step per pixel rather than from the
    // uv derivatives, which jump across the atan2 seam and draw a line there.
    // Latitude is uniform; longitude texels get denser toward the poles
    // (1 / cos latitude) and that term diverges at the pole itself, which would
    // select the top mip and paint the zenith the image's average colour, so it
    // is capped at a few times the latitude term - bounded blur instead.
    let step = max(length(dpdx(dir)), length(dpdy(dir)));
    let cosLat = max(sqrt(max(1.0 - dir.y * dir.y, 0.0)), 1e-4);
    let texelsLat = step * uniform.sky_textureSize.y / PI;
    let texelsLong = step * uniform.sky_textureSize.x / (2.0 * PI * cosLat);
    let texelsPerPixel = max(texelsLat, min(texelsLong, texelsLat * 4.0));
    let lod = log2(max(texelsPerPixel, 1e-6));

    let sample = textureSampleLevel(sky_texture, sky_texture_sampler, uv, lod).rgb;

    // the colour buffer holds display-encoded values (the final blit copies
    // them out); tone map the way the splat shader does: decode, map, re-encode
    let linear = pow(sample, vec3f(2.2));
    let mapped = toneMap(linear);
    let encoded = pow(max(mapped, vec3f(0.0)) + vec3f(0.0000001), vec3f(1.0 / 2.2));

    output.color = vec4f(encoded, 1.0);
    return output;
}
`;

export { vertexShader, fragmentShader };
