import { BooleanInput, Button, Container, Element, Label, SelectInput, SliderInput } from '@playcanvas/pcui';

import { EditOp } from '../edit-ops';
import { Events } from '../events';
import { toolColor } from '../ui/accent'; // [custom]
import { i18n } from '../ui/localization';
import addSvg from '../ui/svg/select-add.svg';
import intersectSvg from '../ui/svg/select-intersect.svg';
import removeSvg from '../ui/svg/select-remove.svg';
import setSvg from '../ui/svg/select-set.svg';
import { Tooltips } from '../ui/tooltips';

// [custom] Eyedropper colour selection (M4): a magic wand session.
//
// A click selects the patch of similar colour under it, like Photoshop's
// wand: the clean render is flood-filled from the click within the tolerance,
// the region's colours become the references and every splat whose footprint
// touches the region and whose colour is within tolerance is selected
// (select.colorWand). A drag seeds the flood from every point along the way.
// Every click / stroke of the session is kept as a seed; Shift starts over.
// Contiguous is **off by default** (user CR 2026-09-12): the seeds' sampled
// colours are matched everywhere in the scene (the global eyedropper); turning
// it on restricts the match to the flooded region under the seeds.
//
// The selection is previewed live: one SelectOp (set/add/remove/intersect
// against the selection that existed when the session started, chosen with
// the op buttons) sits on top of the history and is undone and re-added
// whenever the seeds, the tolerance, the metric, the op or the mode change.
// Anything else landing on the history (Esc = select.none, the user's own
// undo) simply ends the preview; the next change starts a fresh op.
//
// Metrics (see color-match.ts): RGB per channel, HSV (hue wraps, fades with
// saturation), OKLab ΔE (default). One tolerance drives the flood and the match.

type SelectOpKind = 'set' | 'add' | 'remove' | 'intersect';
type Metric = 'rgb' | 'hsv' | 'oklab';
type Rgb = [number, number, number];

type NormalizedPoint = { x: number, y: number };

// stroke points are recorded this far apart (css px); shorter drags are clicks
const STROKE_SPACING = 4;
const STROKE_MIN_LENGTH = 8;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement;
};

const toHex = (c: Rgb) => `#${c.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('')}`;

class EyedropperSelection {
    activate: () => void;
    deactivate: () => void;

    constructor(events: Events, parent: HTMLElement, canvasContainer: Container, tooltips: Tooltips) {
        let pointerId: number | null = null;

        // session state
        let seeds: NormalizedPoint[] = [];
        let previewOp: EditOp | null = null;
        let op: SelectOpKind = 'add';
        let metric: Metric = 'oklab';
        let tolerance = 0.1;
        // user CR 2026-09-12: the session starts in the global (scene-wide)
        // mode; Contiguous is opt-in per session
        let contiguous = false;
        // reference colours dropped by clicking their chips
        let excluded: Rgb[] = [];

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

        // icon-only buttons need localized accessible names
        i18n.onChange(() => {
            opButtons.forEach(([kind, button]) => {
                button.dom.setAttribute('aria-label', i18n.t(`select-toolbar.${kind}`));
            });
        }, setButton);

        const metricSelect = new SelectInput({
            class: 'select-toolbar-select',
            defaultValue: metric
        });
        i18n.bindOptions(metricSelect, () => [
            { v: 'oklab', t: i18n.t('select-toolbar.metric-oklab') },
            { v: 'hsv', t: i18n.t('select-toolbar.metric-hsv') },
            { v: 'rgb', t: i18n.t('select-toolbar.metric-rgb') }
        ]);

        const toleranceLabel = new Label({ class: 'select-toolbar-label' });
        i18n.bindText(toleranceLabel, 'select-toolbar.tolerance');

        const toleranceSlider = new SliderInput({
            class: 'select-toolbar-slider',
            min: 0,
            max: 1,
            step: 0.005,
            precision: 3,
            value: tolerance
        });

        const contiguousLabel = new Label({ class: 'select-toolbar-label' });
        i18n.bindText(contiguousLabel, 'select-toolbar.contiguous');
        const contiguousToggle = new BooleanInput({ class: 'select-toolbar-toggle', value: contiguous });

        // the colours the last match used; click one to drop it
        const samplesContainer = new Container({ class: 'select-toolbar-samples' });

        const clearButton = new Button({ class: 'select-toolbar-button', enabled: false });
        i18n.bindText(clearButton, 'select-toolbar.clear-samples');

        selectToolbar.append(setButton);
        selectToolbar.append(addButton);
        selectToolbar.append(removeButton);
        selectToolbar.append(intersectButton);
        selectToolbar.append(new Element({ class: 'select-toolbar-separator' }));
        selectToolbar.append(metricSelect);
        selectToolbar.append(toleranceLabel);
        selectToolbar.append(toleranceSlider);
        selectToolbar.append(contiguousLabel);
        selectToolbar.append(contiguousToggle);
        selectToolbar.append(new Element({ class: 'select-toolbar-separator' }));
        selectToolbar.append(samplesContainer);
        selectToolbar.append(clearButton);

        canvasContainer.append(selectToolbar);

        const syncOpUI = () => {
            opButtons.forEach(([kind, button]) => {
                button.class[kind === op ? 'add' : 'remove']('active');
            });
        };
        syncOpUI();

        // chip clicks call recompute and recompute refreshes the chips: the
        // chip builder is attached below, once recompute exists
        const chips = { show: (_colors: Rgb[]) => {} };

        // live preview: undo our own op if it is still the top of the history,
        // then add a fresh one for the current seeds. Calls coalesce so a
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
                    if (seeds.length) {
                        const result = await events.invoke('select.colorWand', op, seeds, { metric, tolerance, contiguous, exclude: excluded }) as { op: EditOp, refs: Rgb[] } | null;
                        previewOp = result?.op ?? null;
                        chips.show(result?.refs ?? []);
                    } else {
                        chips.show([]);
                    }
                } while (pending);
            } finally {
                running = false;
            }
        };

        // the references of the last match; clicking a chip drops that colour
        // (and the splats it pulled in) for the rest of the session
        chips.show = (colors: Rgb[]) => {
            // the data panel marks the references on its histogram axes
            events.fire('select.colorRefs', colors.map(c => [...c] as Rgb));
            samplesContainer.clear();
            colors.forEach((color) => {
                const chip = new Element({ class: 'select-toolbar-sample' });
                chip.dom.style.backgroundColor = toHex(color);
                chip.dom.title = toHex(color);
                chip.dom.addEventListener('pointerdown', (event) => {
                    event.stopPropagation();
                    excluded.push(color);
                    recompute();
                });
                samplesContainer.append(chip);
            });
            clearButton.enabled = seeds.length > 0;
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

        metricSelect.on('change', (value: Metric) => {
            metric = value;
            recompute();
        });

        toleranceSlider.on('change', (value: number) => {
            tolerance = clamp01(value ?? tolerance);
            recompute();
        });

        contiguousToggle.on('change', (value: boolean) => {
            contiguous = !!value;
            recompute();
        });

        clearButton.dom.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
            seeds = [];
            excluded = [];
            recompute();
        });

        tooltips.register(setButton, () => i18n.t('select-toolbar.set'), 'top');
        tooltips.register(addButton, () => i18n.t('select-toolbar.add'), 'top');
        tooltips.register(removeButton, () => i18n.t('select-toolbar.remove'), 'top');
        tooltips.register(intersectButton, () => i18n.t('select-toolbar.intersect'), 'top');

        // pointer handling: a click seeds one point, a drag seeds a stroke

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('tool-svg', 'hidden');
        svg.id = 'eyedropper-svg';
        parent.appendChild(svg);
        const polyline = document.createElementNS(svg.namespaceURI, 'polyline') as SVGPolylineElement;
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', toolColor());
        polyline.setAttribute('stroke-width', '2');
        svg.appendChild(polyline);

        type PixelPoint = { x: number, y: number };
        let stroke: PixelPoint[] = [];
        let strokeLength = 0;

        const toNormalizedPoint = (point: PixelPoint): NormalizedPoint => {
            const width = parent.clientWidth || 1;
            const height = parent.clientHeight || 1;
            return {
                x: clamp01(point.x / width),
                y: clamp01(point.y / height)
            };
        };

        const paintStroke = () => {
            polyline.setAttribute('points', stroke.map(p => `${p.x},${p.y}`).join(' '));
        };

        const resetPointer = () => {
            if (pointerId !== null) {
                // a touch that has lifted, or was cancelled, no longer holds
                // the capture and releasing it throws (upstream #1032)
                if (parent.hasPointerCapture(pointerId)) {
                    parent.releasePointerCapture(pointerId);
                }
                pointerId = null;
            }
            stroke = [];
            strokeLength = 0;
            svg.classList.add('hidden');
        };

        const pointerdown = (event: PointerEvent) => {
            if (pointerId === null && (event.pointerType === 'mouse' ? event.button === 0 : event.isPrimary)) {
                event.preventDefault();
                event.stopPropagation();
                pointerId = event.pointerId;
                parent.setPointerCapture(pointerId);
                stroke = [{ x: event.offsetX, y: event.offsetY }];
                strokeLength = 0;
                paintStroke();
                svg.classList.remove('hidden');
            }
        };

        const pointermove = (event: PointerEvent) => {
            if (event.pointerId === pointerId) {
                event.preventDefault();
                event.stopPropagation();
                const last = stroke[stroke.length - 1];
                const distance = Math.hypot(event.offsetX - last.x, event.offsetY - last.y);
                if (distance >= STROKE_SPACING) {
                    stroke.push({ x: event.offsetX, y: event.offsetY });
                    strokeLength += distance;
                    paintStroke();
                }
            }
        };

        const pointerup = (event: PointerEvent) => {
            if (event.pointerId === pointerId) {
                event.preventDefault();
                event.stopPropagation();
                const newSet = event.shiftKey;
                const points = stroke.map(toNormalizedPoint);
                const isStroke = strokeLength >= STROKE_MIN_LENGTH;
                resetPointer();

                if (newSet) {
                    seeds = [];
                    excluded = [];
                }
                seeds.push(...(isStroke ? points : [points[points.length - 1]]));
                recompute();
            }
        };

        const pointercancel = (event: PointerEvent) => {
            if (event.pointerId === pointerId) {
                event.preventDefault();
                event.stopPropagation();
                resetPointer();
            }
        };

        this.activate = () => {
            parent.style.display = 'block';
            selectToolbar.hidden = false;
            parent.addEventListener('pointerdown', pointerdown);
            parent.addEventListener('pointermove', pointermove);
            parent.addEventListener('pointerup', pointerup);
            parent.addEventListener('pointercancel', pointercancel);
        };

        this.deactivate = () => {
            parent.style.display = 'none';
            selectToolbar.hidden = true;
            resetPointer();
            parent.removeEventListener('pointerdown', pointerdown);
            parent.removeEventListener('pointermove', pointermove);
            parent.removeEventListener('pointerup', pointerup);
            parent.removeEventListener('pointercancel', pointercancel);
            // the preview op stays in the history as a normal selection; the
            // session's seeds do not outlive the tool
            seeds = [];
            excluded = [];
            previewOp = null;
            chips.show([]);
        };
    }
}

export { EyedropperSelection };
