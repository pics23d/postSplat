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
            { keys: combo('Alt', 'hint.key-wheel'), localeKey: 'hint.depth-plane' }
        ]);

        const orbit = section('popup.shortcuts.navigation', [
            { keys: word('hint.key-drag'), localeKey: 'hint.orbit' },
            { keys: word('hint.key-right-drag'), localeKey: 'hint.pan' },
            { keys: word('hint.key-wheel'), localeKey: 'hint.zoom' },
            { keys: combo('Ctrl', 'hint.key-wheel'), localeKey: 'hint.orbit' },
            { keys: combo('Shift', 'hint.key-wheel'), localeKey: 'hint.pan' },
            { keys: word('hint.key-double-click'), localeKey: 'hint.focus-point' },
            { keys: shortcut('camera.focus'), localeKey: 'popup.shortcuts.focus-camera' },
            { keys: shortcut('camera.toggleControlMode'), localeKey: 'popup.shortcuts.toggle-control-mode' }
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
            { keys: shortcut('camera.toggleControlMode'), localeKey: 'popup.shortcuts.toggle-control-mode' }
        ]);

        let activeTool: string | null = (events.invoke('tool.active') as string) ?? null;
        let controlMode: string = (events.invoke('camera.controlMode') as string) ?? 'orbit';

        const update = () => {
            const selecting = activeTool !== null && SELECTION_TOOLS.has(activeTool);
            selection.container.hidden = !selecting;
            selection.byId.get('brush').hidden = !(activeTool !== null && BRUSH_TOOLS.has(activeTool));
            orbit.container.hidden = selecting || controlMode === 'fly';
            fly.container.hidden = selecting || controlMode !== 'fly';
        };

        events.on('tool.activated', (toolName: string | null) => {
            activeTool = toolName ?? null;
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
