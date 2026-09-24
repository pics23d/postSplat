#!/usr/bin/env python3
"""[custom] Generate the postSplat logo: SVG for the app UI, PNG for the icons.

The mark is a disc split down the middle. The left half is a raw capture -
sparse, irregular, semi-transparent anisotropic gaussians, with one orange
stray. The right half is the same content resolved: dense, aligned, opaque.
That is what the editor does, so that is what the mark says.

Anisotropic ellipses (not circles) are the signature of 3D gaussian splatting,
and they also keep the mark structurally distinct from upstream SuperSplat's,
which is built from perfect circles.

Colours come from the brand tokens: blue is the brand, the single orange stray
is the viewport tool colour, so the logo carries the same two-colour logic as
the app itself.

    python scripts/make-logo.py

Writes src/ui/svg/logo.svg, static/icons/logo-192.png, static/icons/logo-512.png.
"""

import os
import sys

from PIL import Image, ImageDraw

BRAND = (0x74, 0xA6, 0xF9)      # --clr-hilight
TOOL = (0xFF, 0x66, 0x00)       # --clr-tool, the stray being removed
VB = 64                         # viewBox units
CX = CY = 32.0
R = 30.0

# right half: the resolved result. Aligned, evenly stacked, full opacity.
# rx varies slightly so it reads as settled content rather than a printed bar.
# Wide enough to be clipped on BOTH sides: the disc edge cuts them on the right
# and the split line on the left, so the half-disc silhouette comes from the
# clip, not from the ellipse widths. That is what makes it read at 16px.
SPLIT = 33.5                    # x of the seam
RESOLVED = [
    # (cx, cy, rx, ry)
    (48.0, 8.5, 24.0, 2.7),
    (48.0, 15.0, 24.0, 2.9),
    (48.0, 21.5, 24.0, 3.0),
    (48.0, 28.0, 24.0, 3.1),
    (48.0, 34.5, 24.0, 3.1),
    (48.0, 41.0, 24.0, 3.0),
    (48.0, 47.5, 24.0, 2.9),
    (48.0, 54.0, 24.0, 2.7),
]

# left half: the raw capture. Scattered, rotated, faded - floaters and haze.
# (cx, cy, rx, ry, rotation deg, opacity)
# Opacities stay high enough to survive the downscale to 16px - the whole point
# of the mark is the contrast between the two halves, and a ghost left side
# just reads as a blue blob.
SCATTER = [
    (13.0, 11.0, 5.4, 1.8, -28.0, 0.62),
    (24.0, 16.0, 4.2, 1.6, 42.0, 0.78),
    (9.0, 21.0, 6.2, 2.0, 14.0, 0.55),
    (19.5, 26.0, 4.8, 1.7, -55.0, 0.72),
    (27.0, 33.0, 3.8, 1.5, 22.0, 0.85),
    (11.5, 37.0, 5.8, 1.9, -12.0, 0.58),
    (21.0, 44.5, 4.4, 1.6, 63.0, 0.68),
    (14.0, 51.0, 5.0, 1.8, -35.0, 0.50),
]
STRAY = (25.5, 22.5, 4.6, 1.7, -48.0, 1.0)   # the orange one, mid-removal


def svg() -> str:
    def rgb(c):
        return '#%02x%02x%02x' % c

    out = [
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{VB}' height='{VB}' "
        f"viewBox='0 0 {VB} {VB}'>",
        '  <defs>',
        f"    <clipPath id='ps-disc'><circle cx='{CX}' cy='{CY}' r='{R}'/></clipPath>",
        f"    <clipPath id='ps-seam'><rect x='{SPLIT}' y='0' width='{VB}' height='{VB}'/></clipPath>",
        '  </defs>',
        "  <g clip-path='url(#ps-disc)'>",
        '    <!-- resolved half: clipped to the seam, so the disc edge does the work -->',
        "    <g clip-path='url(#ps-seam)'>",
    ]
    for cx, cy, rx, ry in RESOLVED:
        out.append(f"      <ellipse cx='{cx}' cy='{cy}' rx='{rx}' ry='{ry}' fill='{rgb(BRAND)}'/>")
    out.append('    </g>')
    out.append('    <!-- raw capture: scattered gaussians -->')
    for cx, cy, rx, ry, rot, op in SCATTER:
        out.append(
            f"    <ellipse cx='{cx}' cy='{cy}' rx='{rx}' ry='{ry}' fill='{rgb(BRAND)}' "
            f"fill-opacity='{op}' transform='rotate({rot} {cx} {cy})'/>")
    cx, cy, rx, ry, rot, op = STRAY
    out.append('    <!-- the stray being removed -->')
    out.append(
        f"    <ellipse cx='{cx}' cy='{cy}' rx='{rx}' ry='{ry}' fill='{rgb(TOOL)}' "
        f"fill-opacity='{op}' transform='rotate({rot} {cx} {cy})'/>")
    out += ['  </g>', '</svg>', '']
    return '\n'.join(out)


def ellipse(layer, cx, cy, rx, ry, rot, colour, opacity, s):
    """Draw one rotated ellipse onto `layer` at supersample factor `s`."""
    pad = int(max(rx, ry) * s * 2) + 4
    box = Image.new('RGBA', (pad * 2, pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(box).ellipse(
        [pad - rx * s, pad - ry * s, pad + rx * s, pad + ry * s],
        fill=colour + (int(round(opacity * 255)),))
    if rot:
        box = box.rotate(-rot, resample=Image.BICUBIC)
    layer.alpha_composite(box, (int(cx * s) - pad, int(cy * s) - pad))


def png(size: int) -> Image.Image:
    s = 8                       # supersample, downscaled at the end
    dim = VB * s
    img = Image.new('RGBA', (dim, dim), (0, 0, 0, 0))

    res = Image.new('RGBA', (dim, dim), (0, 0, 0, 0))
    for cx, cy, rx, ry in RESOLVED:
        ellipse(res, cx, cy, rx, ry, 0.0, BRAND, 1.0, s)
    seam = Image.new('L', (dim, dim), 0)
    ImageDraw.Draw(seam).rectangle([SPLIT * s, 0, dim, dim], fill=255)
    res.putalpha(Image.composite(res.getchannel('A'), Image.new('L', (dim, dim), 0), seam))
    img.alpha_composite(res)
    for cx, cy, rx, ry, rot, op in SCATTER:
        ellipse(img, cx, cy, rx, ry, rot, BRAND, op, s)
    cx, cy, rx, ry, rot, op = STRAY
    ellipse(img, cx, cy, rx, ry, rot, TOOL, op, s)

    # clip to the disc
    mask = Image.new('L', (dim, dim), 0)
    ImageDraw.Draw(mask).ellipse(
        [(CX - R) * s, (CY - R) * s, (CX + R) * s, (CY + R) * s], fill=255)
    img.putalpha(Image.composite(img.getchannel('A'), Image.new('L', (dim, dim), 0), mask))

    return img.resize((size, size), Image.LANCZOS)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    svg_path = os.path.join(root, 'src', 'ui', 'svg', 'logo.svg')
    with open(svg_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(svg())
    print('wrote', svg_path)

    icons = os.path.join(root, 'static', 'icons')
    os.makedirs(icons, exist_ok=True)
    for n in (192, 512):
        p = os.path.join(icons, f'logo-{n}.png')
        png(n).save(p)
        print('wrote', p)

    # 16px is the size that decides whether a mark works, so make it easy to
    # look at - but do not ship it: everything under static/ goes into the
    # bundle, and nothing references a 16px icon.
    if '--proof' in sys.argv:
        proof = os.path.join(root, 'logo-16-proof.png')
        png(16).save(proof)
        print('wrote', proof, '(16px legibility proof, not shipped)')


if __name__ == '__main__':
    main()
