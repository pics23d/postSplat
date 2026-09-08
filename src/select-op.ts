// Map the keyboard modifiers held during a selection gesture to a selection op.
// [custom] none = add (user CR 2026-09-06: successive gestures accumulate),
// shift = set (new selection), ctrl = remove, shift+ctrl = intersect.
// Upstream: none = set, shift = add.
const opFromModifiers = (e: { shiftKey: boolean; ctrlKey: boolean }) => {
    if (e.shiftKey && e.ctrlKey) return 'intersect';
    if (e.shiftKey) return 'set';
    if (e.ctrlKey) return 'remove';
    return 'add';
};

// [custom] the tools whose gestures go through the modifier mapping above;
// shared by the Esc handling (ToolManager) and the context hint overlay
const SELECTION_TOOLS = new Set([
    'rectSelection', 'brushSelection', 'lassoSelection', 'polygonSelection',
    'sphereBrushSelection', 'floodSelection', 'eyedropperSelection', 'floaterSelection'
]);

export { opFromModifiers, SELECTION_TOOLS };
