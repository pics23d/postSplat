import { Container, Label } from '@playcanvas/pcui';

import { Events } from '../events';
import { SELECTION_TOOLS } from '../select-op';
import { ShortcutManager } from '../shortcut-manager';
import { i18n } from './localization';

// [custom] Context hints in the bottom-left corner of the viewport: the
// modifiers and gestures that apply to what the user is doing right now. A
// selection tool shows the selection modifiers (and the depth plane controls);
// anything else shows the navigation gestures of the current camera mode.
// Every context is built once and toggled, so the i18n bindings stay stable.

type HintRow = {
    // key column: literal text or a builder (shortcut lookups, localized words)
    keys: string | (() => string);
    localeKey: string;
    // optional id for rows shown only in some tools
    id?: string;
};

const BRUSH_TOOLS = new Set(['brushSelection', 'sphereBrushSelection']);

class HintOverlay extends Container {
    constructor(events: Events, args = {}) {
        args = {
            ...args,
            id: 'hint-overlay'
        };

        super(args);

        // the overlay is a toggle (user CR 2026-09-11: it took too much screen
        // space to be always on): the status bar's Hints button and the X here
        // flip it, the state is a persisted preference (hints.visible)
        let visible = false;
        this.hidden = true;
        const close = new Label({ class: 'hint-close', text: '✕' });
        close.dom.setAttribute('role', 'button');
        i18n.onChange(() => close.dom.setAttribute('aria-label', i18n.t('tooltip.status-bar.hints')), close);
        this.append(close);

        const setVisible = (value: boolean) => {
            if (value !== visible) {
                visible = value;
                this.hidden = !visible;
                events.fire('hints.visible', visible);
            }
        };
        events.function('hints.visible', () => visible);
        events.on('hints.setVisible', (value: boolean) => setVisible(!!value));
        events.on('hints.toggle', () => setVisible(!visible));
        close.dom.addEventListener('pointerdown', (event: PointerEvent) => {
            event.stopPropagation();
            setVisible(false);
        });

        const shortcutManager: ShortcutManager = events.invoke('shortcutManager');
        const shortcut = (id: string) => () => shortcutManager.formatShortcut(id) ?? '';
        const word = (localeKey: string) => () => i18n.t(localeKey);
        const combo = (modifier: string, localeKey: string) => () => `${modifier} + ${i18n.t(localeKey)}`;

        const section = (titleKey: string, rows: HintRow[]) => {
            const container = new Container({ class: 'hint-section', hidden: true });
            const title = new Label({ class: 'hint-title' });
            i18n.bindText(title, () => i18n.t(titleKey).toUpperCase());
            container.append(title);

            const byId = new Map<string, Container>();
            for (const row of rows) {
                const entry = new Container({ class: 'hint-row' });
                const keys = new Label({ class: 'hint-keys' });
                if (typeof row.keys === 'function') {
                    i18n.bindText(keys, row.keys);
                } else {
                    keys.text = row.keys;
                }
                const action = new Label({ class: 'hint-action' });
                i18n.bindText(action, row.localeKey);
                entry.append(keys);
                entry.append(action);
                container.append(entry);
                if (row.id) {
                    byId.set(row.id, entry);
                }
            }
            this.append(container);
            return { container, byId };
        };

        const selection = section('popup.shortcuts.selection', [
            { keys: word('hint.key-click-drag'), localeKey: 'popup.shortcuts.add-to-selection' },
            { keys: 'Shift', localeKey: 'hint.new-selection' },
            { keys: 'Ctrl', localeKey: 'popup.shortcuts.remove-from-selection' },
            { keys: 'Ctrl + Shift', localeKey: 'hint.intersect-selection' },
            { keys: combo('Shift', 'hint.key-wheel'), localeKey: 'popup.shortcuts.brush-size', id: 'brush' },
            { keys: shortcut('tool.escape'), localeKey: 'popup.shortcuts.deselect-all' },
            { keys: shortcut('selection.toggleUseDepth'), localeKey: 'popup.shortcuts.toggle-depth' },
            { keys: combo('Alt', 'hint.key-wheel'), localeKey: 'hint.depth-plane' },
            { keys: word('hint.key-right-click'), localeKey: 'hint.context-menu' }
        ]);

        // the eyedropper is a sampling session (M4): clicks collect colour
        // samples and the op buttons in its toolbar replace the modifiers
        const eyedropper = section('popup.shortcuts.selection', [
            { keys: word('hint.key-click'), localeKey: 'hint.add-sample' },
            { keys: word('hint.key-drag'), localeKey: 'hint.sample-region' },
            { keys: combo('Shift', 'hint.key-click'), localeKey: 'hint.new-samples' },
            { keys: shortcut('tool.escape'), localeKey: 'popup.shortcuts.deselect-all' },
            { keys: shortcut('selection.toggleUseDepth'), localeKey: 'popup.shortcuts.toggle-depth' },
            { keys: combo('Alt', 'hint.key-wheel'), localeKey: 'hint.depth-plane' },
            { keys: word('hint.key-right-click'), localeKey: 'hint.context-menu' }
        ]);

        // the floater tool is slider-driven: no gestures, the viewport still
        // navigates, only the shared selection keys apply
        const floater = section('popup.shortcuts.selection', [
            { keys: shortcut('tool.escape'), localeKey: 'popup.shortcuts.deselect-all' },
            { keys: shortcut('selection.toggleUseDepth'), localeKey: 'popup.shortcuts.toggle-depth' },
            { keys: combo('Alt', 'hint.key-wheel'), localeKey: 'hint.depth-plane' },
            { keys: word('hint.key-right-click'), localeKey: 'hint.context-menu' }
        ]);

        const orbit = section('popup.shortcuts.navigation', [
            { keys: word('hint.key-drag'), localeKey: 'hint.orbit' },
            { keys: word('hint.key-right-drag'), localeKey: 'hint.pan' },
            { keys: word('hint.key-wheel'), localeKey: 'hint.zoom' },
            { keys: combo('Ctrl', 'hint.key-wheel'), localeKey: 'hint.orbit' },
            { keys: combo('Shift', 'hint.key-wheel'), localeKey: 'hint.pan' },
            { keys: word('hint.key-double-click'), localeKey: 'hint.focus-point' },
            { keys: shortcut('camera.focus'), localeKey: 'popup.shortcuts.focus-camera' },
            { keys: shortcut('camera.toggleControlMode'), localeKey: 'popup.shortcuts.toggle-control-mode' },
            { keys: word('hint.key-right-click'), localeKey: 'hint.context-menu' }
        ]);

        const fly = section('popup.shortcuts.navigation', [
            { keys: word('hint.key-drag'), localeKey: 'hint.look' },
            { keys: 'W A S D', localeKey: 'popup.shortcuts.fly-movement' },
            { keys: 'Q E', localeKey: 'popup.shortcuts.fly-vertical' },
            { keys: 'Shift', localeKey: 'popup.shortcuts.fly-speed-fast' },
            { keys: 'Alt', localeKey: 'popup.shortcuts.fly-speed-slow' },
            { keys: word('hint.key-wheel'), localeKey: 'hint.fly-wheel' },
            { keys: word('hint.key-right-drag'), localeKey: 'hint.pan' },
            { keys: word('hint.key-double-click'), localeKey: 'hint.focus-point' },
            { keys: shortcut('camera.toggleControlMode'), localeKey: 'popup.shortcuts.toggle-control-mode' },
            { keys: word('hint.key-right-click'), localeKey: 'hint.context-menu' }
        ]);

        // the overlay is built before the tool manager and camera register
        // their functions (invoking them here logged "function not found" at
        // every start); both states arrive through the events below
        let activeTool: string | null = null;
        let controlMode = 'orbit';

        const update = () => {
            const selecting = activeTool !== null && SELECTION_TOOLS.has(activeTool);
            const sampling = activeTool === 'eyedropperSelection';
            const floating = activeTool === 'floaterSelection';
            selection.container.hidden = !selecting || sampling || floating;
            eyedropper.container.hidden = !sampling;
            floater.container.hidden = !floating;
            selection.byId.get('brush').hidden = !(activeTool !== null && BRUSH_TOOLS.has(activeTool));
            orbit.container.hidden = selecting || controlMode === 'fly';
            fly.container.hidden = selecting || controlMode !== 'fly';
        };

        // the tools container covers the viewport (and captures every pointer)
        // while a drawing tool is active, so the ✕ could not be clicked anyway
        // and its cursor flip would only confuse (user decision 2026-09-11):
        // hide it then; tools without a pointer overlay (floater, sphere, box,
        // the gizmos) keep it
        // (looked up per event: the overlay is built before the editor's DOM
        // tree is attached to the document)
        events.on('tool.activated', (toolName: string | null) => {
            activeTool = toolName ?? null;
            const toolsContainer = document.getElementById('tools-container');
            close.hidden = !!toolsContainer && toolsContainer.style.display === 'block';
            update();
        });

        events.on('camera.controlMode', (mode: string) => {
            controlMode = mode;
            update();
        });

        update();
    }
}

export { HintOverlay };
