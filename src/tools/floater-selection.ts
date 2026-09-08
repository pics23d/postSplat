import { Button, Container, Element, Label, NumericInput, SliderInput } from '@playcanvas/pcui';

import { EditOp } from '../edit-ops';
import { Events } from '../events';
import { i18n } from '../ui/localization';
import addSvg from '../ui/svg/select-add.svg';
import intersectSvg from '../ui/svg/select-intersect.svg';
import removeSvg from '../ui/svg/select-remove.svg';
import setSvg from '../ui/svg/select-set.svg';
import { Tooltips } from '../ui/tooltips';

// [custom] Floater selection (user CR 2026-09-08). Floaters in a 3DGS capture
// are large and faint; finding them used to mean switching between the Scale
// Largest and Opacity histograms. This tool combines both into two sliders:
// every splat whose largest scale axis is at least "Min Size" and whose
// opacity is at most "Max Opacity" is selected (select.floaters), previewed
// live with the same one-op-on-top-of-the-history scheme as the eyedropper.
// The size slider spans the scene's actual range of largest scales (read
// from the histogram kernel when the tool activates) on a log scale (user
// decision 2026-09-08 after comparing both: the linear slider was too
// coarse); the slider itself runs over a normalized 0..1 position and a
// separate numeric field shows the real (unbounded) value. The viewport
// keeps its navigation gestures: the tool has no pointer handling of its own.

type SelectOpKind = 'set' | 'add' | 'remove' | 'intersect';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// a log slider needs a positive floor: at most four decades below the top
const LOG_DECADES = 4;

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement;
};

class FloaterSelection {
    activate: () => void;
    deactivate: () => void;

    constructor(events: Events, canvasContainer: Container, tooltips: Tooltips) {
        // session state; the thresholds persist between activations
        let previewOp: EditOp | null = null;
        let op: SelectOpKind = 'set';
        let minScale: number | null = null;
        let maxOpacity = 0.5;
        let active = false;
        // the size slider's span (the scene's largest scales), mapped on a log scale
        let range: { min: number, max: number } | null = null;

        const logFloor = () => Math.max(range.min, range.max * 10 ** -LOG_DECADES);
        const positionToSize = (t: number) => {
            if (!range) return 0;
            const lo = Math.log(logFloor());
            const hi = Math.log(range.max);
            return Math.exp(lo + (hi - lo) * clamp01(t));
        };
        const sizeToPosition = (size: number) => {
            if (!range || !(range.max > range.min)) return 0;
            const lo = Math.log(logFloor());
            const hi = Math.log(range.max);
            return clamp01((Math.log(Math.max(size, logFloor())) - lo) / (hi - lo));
        };

        // ui

        const selectToolbar = new Container({
            class: 'select-toolbar',
            hidden: true
        });

        selectToolbar.dom.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });

        const setButton = new Button({ class: 'select-toolbar-op' });
        const addButton = new Button({ class: 'select-toolbar-op' });
        const removeButton = new Button({ class: 'select-toolbar-op' });
        const intersectButton = new Button({ class: 'select-toolbar-op' });

        setButton.dom.appendChild(createSvg(setSvg));
        addButton.dom.appendChild(createSvg(addSvg));
        removeButton.dom.appendChild(createSvg(removeSvg));
        intersectButton.dom.appendChild(createSvg(intersectSvg));

        const opButtons: [SelectOpKind, Button][] = [
            ['set', setButton], ['add', addButton], ['remove', removeButton], ['intersect', intersectButton]
        ];

        i18n.onChange(() => {
            opButtons.forEach(([kind, button]) => {
                button.dom.setAttribute('aria-label', i18n.t(`select-toolbar.${kind}`));
            });
        }, setButton);

        const sizeLabel = new Label({ class: 'select-toolbar-label' });
        i18n.bindText(sizeLabel, 'select-toolbar.min-size');

        // the real value; unbounded above
        const sizeInput = new NumericInput({
            class: 'select-toolbar-number',
            min: 0,
            precision: 3,
            value: 0
        });

        // the slider position (0..1), mapped to a size on a log scale
        const sizeSlider = new SliderInput({
            class: ['select-toolbar-slider', 'select-toolbar-slider-bare'],
            min: 0,
            max: 1,
            step: 0.001,
            precision: 3,
            value: 0.5
        });

        const opacityLabel = new Label({ class: 'select-toolbar-label' });
        i18n.bindText(opacityLabel, 'select-toolbar.max-opacity');

        const opacitySlider = new SliderInput({
            class: 'select-toolbar-slider',
            min: 0,
            max: 1,
            step: 0.005,
            precision: 3,
            value: maxOpacity
        });

        selectToolbar.append(setButton);
        selectToolbar.append(addButton);
        selectToolbar.append(removeButton);
        selectToolbar.append(intersectButton);
        selectToolbar.append(new Element({ class: 'select-toolbar-separator' }));
        selectToolbar.append(sizeLabel);
        selectToolbar.append(sizeInput);
        selectToolbar.append(sizeSlider);
        selectToolbar.append(opacityLabel);
        selectToolbar.append(opacitySlider);

        canvasContainer.append(selectToolbar);

        const syncOpUI = () => {
            opButtons.forEach(([kind, button]) => {
                button.class[kind === op ? 'add' : 'remove']('active');
            });
        };
        syncOpUI();

        // live preview: undo our own op if it is still the top of the history,
        // then add a fresh one for the current thresholds. Calls coalesce so a
        // slider drag never queues more than one GPU pass ahead.
        let running = false;
        let pending = false;
        const recompute = async () => {
            if (running) {
                pending = true;
                return;
            }
            running = true;
            try {
                do {
                    pending = false;
                    if (previewOp && events.invoke('edit.top') === previewOp) {
                        events.fire('edit.undo');
                    }
                    previewOp = null;
                    if (active && minScale !== null) {
                        previewOp = await events.invoke('select.floaters', op, { minScale, maxOpacity }) as EditOp | null;
                    }
                } while (pending);
            } finally {
                running = false;
            }
        };

        opButtons.forEach(([kind, button]) => {
            button.dom.addEventListener('pointerdown', (event) => {
                event.stopPropagation();
                if (op !== kind) {
                    op = kind;
                    syncOpUI();
                    recompute();
                }
            });
        });

        // programmatic updates (range setup, mirroring one control into the
        // other) must not read back as edits
        let syncing = false;

        const syncSizeControls = () => {
            syncing = true;
            sizeInput.value = minScale ?? 0;
            sizeSlider.value = minScale === null ? 0 : sizeToPosition(minScale);
            syncing = false;
        };

        sizeSlider.on('change', (value: number) => {
            if (syncing || !Number.isFinite(value) || !range) return;
            minScale = positionToSize(value);
            syncing = true;
            sizeInput.value = minScale;
            syncing = false;
            recompute();
        });

        sizeInput.on('change', (value: number) => {
            if (syncing || !Number.isFinite(value)) return;
            minScale = Math.max(0, value);
            syncing = true;
            sizeSlider.value = sizeToPosition(minScale);
            syncing = false;
            recompute();
        });

        opacitySlider.on('change', (value: number) => {
            if (syncing || !Number.isFinite(value)) return;
            maxOpacity = clamp01(value);
            recompute();
        });

        tooltips.register(setButton, () => i18n.t('select-toolbar.set'), 'top');
        tooltips.register(addButton, () => i18n.t('select-toolbar.add'), 'top');
        tooltips.register(removeButton, () => i18n.t('select-toolbar.remove'), 'top');
        tooltips.register(intersectButton, () => i18n.t('select-toolbar.intersect'), 'top');

        // the size slider spans the scene's range of largest scales; the first
        // activation starts the threshold in the upper half of that range,
        // later ones keep the user's value (clamped into the new range)
        const setupRange = async () => {
            const result = await events.invoke('select.floaterRange') as { min: number, max: number } | null;
            if (!active) return;
            if (!result || !(result.max > result.min)) {
                range = null;
                minScale = null;
                syncSizeControls();
                return;
            }
            range = result;
            if (minScale === null) {
                minScale = positionToSize(0.5);
            } else {
                minScale = Math.min(range.max, Math.max(range.min, minScale));
            }
            syncSizeControls();
            recompute();
        };

        this.activate = () => {
            active = true;
            selectToolbar.hidden = false;
            setupRange();
        };

        this.deactivate = () => {
            active = false;
            selectToolbar.hidden = true;
            // the preview op stays in the history as a normal selection
            previewOp = null;
        };
    }
}

export { FloaterSelection };
