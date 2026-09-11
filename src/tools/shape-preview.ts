import { Mat4 } from 'playcanvas';

import { Events } from '../events';

// [custom] Live preview for the sphere / box selection tools (user CR
// 2026-09-11): while the tool is active, the splats its volume would select
// are tinted in the preview colour (see previewTint in the renderer). Every
// frame compares a signature of the volume's transform, the selection
// settings that gate the intersect and the edit target; a change asks the
// editor for a fresh preview mask (select.previewShape), so gizmo drags,
// numeric inputs, undo, the footprint / depth toggles and layer switches are
// all covered by the one hook. The editor coalesces the GPU passes.
class ShapePreview {
    clear: () => void;

    constructor(events: Events, kind: 'sphere' | 'box', isActive: () => boolean, transform: () => Mat4) {
        let last = '';

        this.clear = () => {
            last = '';
            events.fire('select.previewClear');
        };

        events.on('prerender', () => {
            if (!isActive()) {
                if (last) {
                    this.clear();
                }
                return;
            }
            const t = transform();
            const splat = events.invoke('selection');
            const signature = [
                Array.from(t.data as Float32Array).map(v => v.toFixed(5)).join(','),
                events.invoke('selection.footprint'),
                events.invoke('selection.effectiveDepthFar'),
                splat?.instances.count ?? 0,
                splat?.uid ?? ''
            ].join('|');
            if (signature !== last) {
                last = signature;
                events.fire('select.previewShape', kind, t.clone());
            }
        });
    }
}

export { ShapePreview };
