// [custom] Single source of truth for the accent colours.
//
// SCSS owns them (src/ui/scss/colors.scss) and publishes both as custom
// properties on :root. Canvas strokes and SVG attributes are set from
// TypeScript, which cannot read SCSS variables, so they read them back here
// instead of spelling the hex out — a rebrand is then one edit in one file.
//
// Two tokens, deliberately:
//   --clr-hilight  brand accent, UI chrome only
//   --clr-tool     viewport overlays drawn over the scene (marquee, brush,
//                  lasso, polygon, wand). Kept at the brand's near-complement:
//                  a stroke in the brand blue sits ~11 degrees from typical sky
//                  at 1.14:1 contrast, i.e. invisible over the content this
//                  editor exists to select.

const cache = new Map<string, string>();

const cssVar = (name: string, fallback: string): string => {
    const hit = cache.get(name);
    if (hit !== undefined) {
        return hit;
    }
    // getComputedStyle returns '' before the stylesheet has applied; don't
    // cache that, so the first real read after load still wins
    const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
    if (!value) {
        return fallback;
    }
    cache.set(name, value);
    return value;
};

/** Viewport overlay colour: selection marquee, brush circle, wand polyline. */
const toolColor = () => cssVar('--clr-tool', '#f60');

/** Lighter tool tint: the closed state of the lasso and polygon outlines. */
const toolColorLight = () => cssVar('--clr-tool-light', '#fa6');

/** Brand accent: UI chrome only, never drawn over the scene. */
const hilightColor = () => cssVar('--clr-hilight', '#74a6f9');

export { toolColor, toolColorLight, hilightColor };
