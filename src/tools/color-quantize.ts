// [custom] Reduce the colours sampled along an eyedropper stroke to a few
// representative references (M4). Pure, unit-tested; the metric mirrors the
// OKLab conversion in src/shaders/splat-value-shader.ts.

type Rgb = [number, number, number];

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

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

const oklabDistance = (a: Rgb, b: Rgb) => {
    const x = rgbToOklab(a), y = rgbToOklab(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

// Greedy online clustering in OKLab: a colour joins the nearest cluster within
// mergeDistance (running mean), otherwise starts one. The clusters are
// returned largest first, at most maxCount of them; clusters holding less than
// minShare of the samples are dropped (a wand region's edge blends, 2026-09-07).
// Deterministic and linear in the number of samples, which is what a stroke of
// a few hundred points needs.
const quantizeColors = (colors: Rgb[], maxCount: number, mergeDistance = 0.05, minShare = 0): Rgb[] => {
    if (maxCount <= 0) {
        return [];
    }
    const clusters: { sum: Rgb, count: number, mean: Rgb }[] = [];
    for (const color of colors) {
        let best = null;
        let bestDistance = mergeDistance;
        for (const cluster of clusters) {
            const distance = oklabDistance(color, cluster.mean);
            if (distance <= bestDistance) {
                best = cluster;
                bestDistance = distance;
            }
        }
        if (best) {
            best.sum = [best.sum[0] + color[0], best.sum[1] + color[1], best.sum[2] + color[2]];
            best.count++;
            best.mean = [best.sum[0] / best.count, best.sum[1] / best.count, best.sum[2] / best.count];
        } else {
            clusters.push({ sum: [...color], count: 1, mean: [...color] });
        }
    }
    clusters.sort((a, b) => b.count - a.count);
    const minCount = minShare * colors.length;
    return clusters.filter(c => c.count >= minCount).slice(0, maxCount).map(c => c.mean);
};

export { quantizeColors, rgbToOklab, oklabDistance };
export type { Rgb };
