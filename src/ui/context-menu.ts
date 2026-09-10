import { Container, Element } from '@playcanvas/pcui';

import { Events } from '../events';
import { SELECTION_TOOLS } from '../select-op';
import { ShortcutManager } from '../shortcut-manager';
import { i18n } from './localization';
import { MenuItem, MenuPanel } from './menu-panel';
import selectDelete from './svg/delete.svg';
import hiddenSvg from './svg/hidden.svg';
import selectAll from './svg/select-all.svg';
import selectDuplicate from './svg/select-duplicate.svg';
import selectInverse from './svg/select-inverse.svg';
import selectNone from './svg/select-none.svg';
import selectSeparate from './svg/select-separate.svg';
import shownSvg from './svg/shown.svg';

// [custom] Viewport context menu (user CR 2026-09-07): a right-click without a
// drag opens a short, mode-dependent list at the cursor (the PointerController
// fires contextMenu.open; right-drag still pans). While a selection tool is
// active the list leads with the selection edits, otherwise with the camera
// actions. Every entry reuses an existing event and locale key, so the labels
// and shortcuts stay in sync with the menu bar and the shortcuts popup.

type OpenRequest = {
    clientX: number;
    clientY: number;
    // normalized viewport coordinates (0..1) for the focal point pick
    x: number;
    y: number;
};

const EDGE_MARGIN = 4;

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new Element({
        dom: new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement
    });
};

class ContextMenu extends Container {
    constructor(events: Events, args = {}) {
        args = {
            ...args,
            id: 'context-menu'
        };

        super(args);

        const shortcutManager: ShortcutManager = events.invoke('shortcutManager');
        const shortcut = (id: string) => shortcutManager.formatShortcut(id);
        const hasSelection = () => !!events.invoke('selection.splats');

        // the point of the last right-click, consumed by "Focus on Point"
        let point = { x: 0.5, y: 0.5 };

        const focusPoint: MenuItem = {
            text: () => i18n.t('hint.focus-point'),
            onSelect: () => events.fire('camera.pickFocalPoint', point.x, point.y)
        };
        const focusSelection: MenuItem = {
            text: () => i18n.t('popup.shortcuts.focus-camera'),
            extra: shortcut('camera.focus'),
            isEnabled: hasSelection,
            onSelect: () => events.fire('camera.focus')
        };
        const resetCamera: MenuItem = {
            text: () => i18n.t('popup.shortcuts.reset-camera'),
            extra: shortcut('camera.reset'),
            onSelect: () => events.fire('camera.reset')
        };
        const toggleControlMode: MenuItem = {
            text: () => i18n.t('popup.shortcuts.toggle-control-mode'),
            extra: shortcut('camera.toggleControlMode'),
            onSelect: () => events.fire('camera.toggleControlMode')
        };
        const selectAllItem: MenuItem = {
            text: () => i18n.t('popup.shortcuts.select-all'),
            icon: createSvg(selectAll),
            extra: shortcut('select.all'),
            onSelect: () => events.fire('select.all')
        };
        const selectNoneItem: MenuItem = {
            text: () => i18n.t('popup.shortcuts.deselect-all'),
            icon: createSvg(selectNone),
            extra: shortcut('select.none'),
            isEnabled: hasSelection,
            onSelect: () => events.fire('select.none')
        };
        const invertItem: MenuItem = {
            text: () => i18n.t('popup.shortcuts.invert-selection'),
            icon: createSvg(selectInverse),
            extra: shortcut('select.invert'),
            onSelect: () => events.fire('select.invert')
        };
        // Hide Selected / Hide Unselected / Unhide All (replace Lock / Unlock,
        // user CR 2026-09-08); enable rules mirror the Select menu
        const activeSplat = () => events.invoke('selection');
        const hideSelectedItem: MenuItem = {
            text: () => i18n.t('popup.shortcuts.hide-selected-splats'),
            icon: createSvg(hiddenSvg),
            extra: shortcut('select.hide'),
            isEnabled: hasSelection,
            onSelect: () => events.fire('select.hide')
        };
        const hideUnselectedItem: MenuItem = {
            text: () => i18n.t('popup.shortcuts.hide-unselected-splats'),
            icon: createSvg(hiddenSvg),
            extra: shortcut('select.hideUnselected'),
            isEnabled: () => {
                const splat = activeSplat();
                return !!splat && splat.numSplats - splat.numHidden - splat.numSelected > 0;
            },
            onSelect: () => events.fire('select.hideUnselected')
        };
        const unhideAllItem: MenuItem = {
            text: () => i18n.t('popup.shortcuts.unhide-all-splats'),
            icon: createSvg(shownSvg),
            extra: shortcut('select.unhide'),
            isEnabled: () => (activeSplat()?.numHidden ?? 0) > 0,
            onSelect: () => events.fire('select.unhide')
        };
        const deleteItem: MenuItem = {
            text: () => i18n.t('popup.shortcuts.delete-selected-splats'),
            icon: createSvg(selectDelete),
            extra: shortcut('select.delete'),
            isEnabled: hasSelection,
            onSelect: () => events.fire('select.delete')
        };
        const duplicateItem: MenuItem = {
            text: () => i18n.t('menu.edit.duplicate'),
            icon: createSvg(selectDuplicate),
            isEnabled: hasSelection,
            onSelect: () => events.fire('edit.duplicate')
        };
        const separateItem: MenuItem = {
            text: () => i18n.t('menu.edit.separate'),
            icon: createSvg(selectSeparate),
            isEnabled: hasSelection,
            onSelect: () => events.fire('edit.separate')
        };
        const toggleDepth: MenuItem = {
            text: () => i18n.t('popup.shortcuts.toggle-depth'),
            extra: shortcut('selection.toggleUseDepth'),
            onSelect: () => events.fire('selection.toggleUseDepth')
        };
        const deactivateTool: MenuItem = {
            text: () => i18n.t('popup.shortcuts.deactivate-tool'),
            onSelect: () => events.fire('tool.deactivate')
        };
        const separator: MenuItem = {};

        // no selection tool: camera first, then the selection edits
        const navigationPanel = new MenuPanel([
            focusPoint, focusSelection, resetCamera, toggleControlMode,
            separator,
            selectAllItem, selectNoneItem, invertItem,
            separator,
            hideSelectedItem, hideUnselectedItem, unhideAllItem, deleteItem
        ]);

        // a selection tool is active: the edits first, then the tool controls
        const selectionPanel = new MenuPanel([
            deleteItem, hideSelectedItem, hideUnselectedItem, unhideAllItem,
            separator,
            duplicateItem, separateItem,
            separator,
            selectAllItem, selectNoneItem, invertItem, toggleDepth,
            separator,
            focusPoint, deactivateTool
        ]);

        // a Scene Manager row (user CR 2026-09-08): the hide ops for that layer,
        // which the row's right-click has just made the edit target
        const layerPanel = new MenuPanel([
            hideSelectedItem, hideUnselectedItem, unhideAllItem
        ]);

        this.append(navigationPanel);
        this.append(selectionPanel);
        this.append(layerPanel);

        const panels = [navigationPanel, selectionPanel, layerPanel];
        const isOpen = () => panels.some(panel => !panel.hidden);
        const hide = () => {
            panels.forEach((panel) => {
                panel.hidden = true;
            });
        };

        let activeTool: string | null = null;
        events.on('tool.activated', (toolName: string | null) => {
            activeTool = toolName ?? null;
            hide();
        });
        events.on('camera.controlMode', () => hide());

        const show = (panel: MenuPanel, request: OpenRequest) => {
            hide();
            point = { x: request.x, y: request.y };

            const parentRect = this.dom.getBoundingClientRect();
            let left = request.clientX - parentRect.left;
            let top = request.clientY - parentRect.top;
            panel.dom.style.left = `${left}px`;
            panel.dom.style.top = `${top}px`;
            panel.hidden = false;

            // keep the panel inside the viewport; measured after it is shown
            left = Math.min(left, parentRect.width - panel.dom.offsetWidth - EDGE_MARGIN);
            top = Math.min(top, parentRect.height - panel.dom.offsetHeight - EDGE_MARGIN);
            panel.dom.style.left = `${Math.max(EDGE_MARGIN, left)}px`;
            panel.dom.style.top = `${Math.max(EDGE_MARGIN, top)}px`;
        };

        events.on('contextMenu.open', (request: OpenRequest) => {
            show(activeTool !== null && SELECTION_TOOLS.has(activeTool) ? selectionPanel : navigationPanel, request);
        });

        events.on('contextMenu.openLayer', (request: { clientX: number, clientY: number }) => {
            show(layerPanel, { ...request, x: 0.5, y: 0.5 });
        });

        // any press outside the panel closes it (capture phase so the rows'
        // stopPropagation on pointerdown does not matter); a right-click
        // elsewhere therefore closes on press and reopens on release
        window.addEventListener('pointerdown', (event: PointerEvent) => {
            if (isOpen() && !this.dom.contains(event.target as Node)) {
                hide();
            }
        }, true);

        // Esc closes the menu before the shortcut handlers see it (document
        // capture in shortcuts.ts runs after this window capture listener)
        window.addEventListener('keydown', (event: KeyboardEvent) => {
            if (isOpen() && event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                hide();
            }
        }, true);

        // the camera moving under the menu closes it
        window.addEventListener('wheel', () => {
            if (isOpen()) hide();
        }, { capture: true, passive: true });
    }
}

export { ContextMenu };
