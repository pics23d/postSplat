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

export { opFromModifiers };
