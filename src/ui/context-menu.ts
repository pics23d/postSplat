import { Container, Element } from '@playcanvas/pcui';

import { Events } from '../events';
import { SELECTION_TOOLS } from '../select-op';
import { ShortcutManager } from '../shortcut-manager';
import { i18n } from './localization';
import { MenuItem, MenuPanel } from './menu-panel';
import selectDelete from './svg/delete.svg';
import selectAll from './svg/select-all.svg';
import selectDuplicate from './svg/select-duplicate.svg';
import selectInverse from './svg/select-inverse.svg';
import selectLock from './svg/select-lock.svg';
import selectNone from './svg/select-none.svg';
import selectSeparate from './svg/select-separate.svg';
import selectUnlock from './svg/select-unlock.svg';

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
        const lockItem: MenuItem = {
            text: () => i18n.t('popup.shortcuts.lock-selected-splats'),
            icon: createSvg(selectLock),
            extra: shortcut('select.hide'),
            isEnabled: hasSelection,
            onSelect: () => events.fire('select.hide')
        };
        const unlockItem: MenuItem = {
            text: () => i18n.t('popup.shortcuts.unlock-all-splats'),
            icon: createSvg(selectUnlock),
            extra: shortcut('select.unhide'),
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
            lockItem, unlockItem, deleteItem
        ]);

        // a selection tool is active: the edits first, then the tool controls
        const selectionPanel = new MenuPanel([
            deleteItem, lockItem, unlockItem,
            separator,
            duplicateItem, separateItem,
            separator,
            selectAllItem, selectNoneItem, invertItem, toggleDepth,
            separator,
            focusPoint, deactivateTool
        ]);

        this.append(navigationPanel);
        this.append(selectionPanel);

        const panels = [navigationPanel, selectionPanel];
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

        const show = (request: OpenRequest) => {
            hide();
            point = { x: request.x, y: request.y };

            const panel = activeTool !== null && SELECTION_TOOLS.has(activeTool) ? selectionPanel : navigationPanel;
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

        events.on('contextMenu.open', (request: OpenRequest) => show(request));

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
