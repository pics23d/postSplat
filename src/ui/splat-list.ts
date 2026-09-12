import { Container, Label, Element as PcuiElement, TextInput } from '@playcanvas/pcui';

import { SplatRenameOp } from '../edit-ops';
import { Element, ElementType } from '../element';
import { Events } from '../events';
import { Skybox } from '../skybox'; // [custom]
import { Splat } from '../splat';
import { i18n } from './localization'; // [custom]
import deleteSvg from './svg/delete.svg';
import hiddenSvg from './svg/hidden.svg';
import shownSvg from './svg/shown.svg';

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement;
};

class SplatItem extends Container {
    getName: () => string;
    setName: (value: string) => void;
    getSelected: () => boolean;
    setSelected: (value: boolean) => void;
    getVisible: () => boolean;
    setVisible: (value: boolean) => void;
    destroy: () => void;

    constructor(name: string, edit: TextInput, args = {}) {
        args = {
            ...args,
            class: ['splat-item', 'visible']
        };

        super(args);

        const text = new Label({
            class: 'splat-item-text',
            text: name
        });

        const visible = new PcuiElement({
            dom: createSvg(shownSvg),
            class: 'splat-item-visible'
        });

        const invisible = new PcuiElement({
            dom: createSvg(hiddenSvg),
            class: 'splat-item-visible',
            hidden: true
        });

        const remove = new PcuiElement({
            dom: createSvg(deleteSvg),
            class: 'splat-item-delete'
        });

        this.append(text);
        this.append(visible);
        this.append(invisible);
        this.append(remove);

        this.getName = () => {
            return text.value;
        };

        this.setName = (value: string) => {
            text.value = value;
        };

        this.getSelected = () => {
            return this.class.contains('selected');
        };

        this.setSelected = (value: boolean) => {
            if (value !== this.selected) {
                if (value) {
                    this.class.add('selected');
                    this.emit('select', this);
                } else {
                    this.class.remove('selected');
                    this.emit('unselect', this);
                }
            }
        };

        this.getVisible = () => {
            return this.class.contains('visible');
        };

        this.setVisible = (value: boolean) => {
            if (value !== this.visible) {
                visible.hidden = !value;
                invisible.hidden = value;
                if (value) {
                    this.class.add('visible');
                    this.emit('visible', this);
                } else {
                    this.class.remove('visible');
                    this.emit('invisible', this);
                }
            }
        };

        const toggleVisible = (event: MouseEvent) => {
            event.stopPropagation();
            this.visible = !this.visible;
        };

        const handleRemove = (event: MouseEvent) => {
            event.stopPropagation();
            this.emit('removeClicked', this);
        };

        // rename on double click
        text.dom.addEventListener('dblclick', (event: MouseEvent) => {
            event.stopPropagation();

            const onblur = () => {
                this.remove(edit);
                this.emit('rename', edit.value);
                edit.input.removeEventListener('blur', onblur);
                text.hidden = false;
            };

            text.hidden = true;

            this.appendAfter(edit, text);
            edit.value = text.value;
            edit.input.addEventListener('blur', onblur);
            edit.focus();
        });

        // handle clicks
        visible.dom.addEventListener('click', toggleVisible);
        invisible.dom.addEventListener('click', toggleVisible);
        remove.dom.addEventListener('click', handleRemove);

        this.destroy = () => {
            visible.dom.removeEventListener('click', toggleVisible);
            invisible.dom.removeEventListener('click', toggleVisible);
            remove.dom.removeEventListener('click', handleRemove);
        };
    }

    set name(value: string) {
        this.setName(value);
    }

    get name() {
        return this.getName();
    }

    set selected(value) {
        this.setSelected(value);
    }

    get selected() {
        return this.getSelected();
    }

    set visible(value) {
        this.setVisible(value);
    }

    get visible() {
        return this.getVisible();
    }
}

class SplatList extends Container {
    constructor(events: Events, args = {}) {
        args = {
            ...args,
            class: 'splat-list'
        };

        super(args);

        const items = new Map<Splat, SplatItem>();
        let soloMode = false;
        const savedVisibility = new Map<Splat, boolean>();

        // edit input used during renames
        const edit = new TextInput({
            id: 'splat-edit'
        });

        // [custom] the skybox layer's row (user CR 2026-09-12): visibility,
        // rename and remove act on the element directly - no history op, no
        // selection, no marks; it is a background image, not a Splat. It stays
        // the last row: splat rows appended later are moved above it.
        let skyboxItem: SplatItem | null = null;
        const keepSkyboxLast = () => {
            if (skyboxItem) {
                this.dom.appendChild(skyboxItem.dom);
            }
        };

        events.on('scene.elementAdded', (element: Element) => {
            if (element.type === ElementType.skybox) {
                const skybox = element as Skybox;
                const item = new SplatItem(skybox.name, edit);
                item.class.add('skybox');
                item.dom.title = i18n.t('panel.scene.skybox');
                this.append(item);
                skyboxItem = item;

                item.on('visible', () => {
                    skybox.visible = true;
                });
                item.on('invisible', () => {
                    skybox.visible = false;
                });
                item.on('rename', (value: string) => {
                    skybox.name = value;
                });
                item.on('removeClicked', async () => {
                    const result = await events.invoke('showPopup', {
                        type: 'yesno',
                        header: i18n.t('popup.remove-skybox'),
                        message: i18n.t('popup.remove-skybox-message', { name: skybox.name })
                    });
                    if (result?.action === 'yes') {
                        skybox.destroy();
                    }
                });
            }
        });

        events.on('scene.elementRemoved', (element: Element) => {
            if (element.type === ElementType.skybox && skyboxItem) {
                this.remove(skyboxItem);
                skyboxItem = null;
            }
        });

        events.on('skybox.visibility', (skybox: Skybox) => {
            if (skyboxItem) {
                skyboxItem.visible = skybox.visible;
            }
        });

        events.on('skybox.name', (skybox: Skybox) => {
            if (skyboxItem) {
                skyboxItem.name = skybox.name;
            }
        });

        events.on('scene.elementAdded', (element: Element) => {
            if (element.type === ElementType.splat) {
                const splat = element as Splat;
                const item = new SplatItem(splat.name, edit);
                this.append(item);
                keepSkyboxLast(); // [custom]
                items.set(splat, item);

                if (soloMode) {
                    savedVisibility.set(splat, splat.visible);
                    splat.visible = false;
                }

                item.on('visible', () => {
                    splat.visible = true;

                    // also select it if there is no other selection
                    if (!events.invoke('selection')) {
                        events.fire('selection', splat);
                    }
                });
                item.on('invisible', () => {
                    splat.visible = false;
                });
                item.on('rename', (value: string) => {
                    events.fire('edit.add', new SplatRenameOp(splat, value));
                });

                // [custom] right-click (user CR 2026-09-08): the row's layer becomes
                // the edit target and its hide / unhide menu opens at the cursor
                item.dom.addEventListener('contextmenu', (event: MouseEvent) => {
                    event.stopPropagation();
                    if (!splat.visible) {
                        return;
                    }
                    events.fire('selection', splat);
                    events.fire('contextMenu.openLayer', { clientX: event.clientX, clientY: event.clientY });
                });
            }
        });

        events.on('scene.elementRemoved', (element: Element) => {
            if (element.type === ElementType.splat) {
                const splat = element as Splat;
                const item = items.get(splat);
                if (item) {
                    this.remove(item);
                    items.delete(splat);
                }
                savedVisibility.delete(splat);
            }
        });

        events.on('selection.changed', (selection: Splat, prev: Splat) => {
            items.forEach((value, key) => {
                value.selected = key === selection;
            });

            if (soloMode) {
                if (prev) {
                    prev.visible = false;
                }
                if (selection) {
                    selection.visible = true;
                }
            }
        });

        events.on('scene.solo', (value: boolean) => {
            soloMode = value;
            const selection = events.invoke('selection') as Splat;

            if (soloMode) {
                items.forEach((item, splat) => {
                    savedVisibility.set(splat, splat.visible);
                    splat.visible = splat === selection;
                });
            } else {
                items.forEach((item, splat) => {
                    const wasVisible = savedVisibility.get(splat);
                    splat.visible = wasVisible !== undefined ? wasVisible : true;
                });
                savedVisibility.clear();
            }
        });

        events.on('splat.name', (splat: Splat) => {
            const item = items.get(splat);
            if (item) {
                item.name = splat.name;
            }
        });

        events.on('splat.visibility', (splat: Splat) => {
            const item = items.get(splat);
            if (item) {
                item.visible = splat.visible;
            }
        });

        // [custom] marks for the layer merge (user CR 2026-09-11): Ctrl+click
        // toggles a row, Shift+click marks the range from the last plain / Ctrl
        // click, a plain click marks that row alone. The clicked row always
        // becomes the edit target as before. `scene.markedSplats` lists the marks in
        // list order; `scene.markSplats` sets them (harness / scripts).
        const marked = new Set<Splat>();
        let anchor: Splat | null = null;
        const markedSplats = () => [...items.keys()].filter(splat => marked.has(splat));
        const notifyMarked = () => {
            items.forEach((item, splat) => {
                item.class[marked.has(splat) ? 'add' : 'remove']('marked');
            });
            events.fire('scene.markedSplats.changed', markedSplats());
        };
        events.function('scene.markedSplats', markedSplats);
        events.on('scene.markSplats', (splats: Splat[]) => {
            marked.clear();
            for (const splat of splats ?? []) {
                if (items.has(splat)) {
                    marked.add(splat);
                }
            }
            anchor = splats?.length ? splats[splats.length - 1] : null;
            notifyMarked();
        });
        events.on('scene.elementRemoved', (element: Element) => {
            if (element.type === ElementType.splat && marked.has(element as Splat)) {
                marked.delete(element as Splat);
                if (anchor === element) {
                    anchor = null;
                }
                notifyMarked();
            }
        });

        this.on('click', (item: SplatItem, event?: MouseEvent) => {
            for (const [key, value] of items) {
                if (item === value) {
                    if (event?.ctrlKey || event?.metaKey) {
                        // file-manager semantics (user feedback 2026-09-11): the
                        // row that is already the edit target counts as marked,
                        // so the first Ctrl+click yields two marks
                        if (marked.size === 0) {
                            const current = events.invoke('selection') as Splat;
                            if (current && current !== key && items.has(current)) {
                                marked.add(current);
                            }
                        }
                        if (marked.has(key)) {
                            marked.delete(key);
                        } else {
                            marked.add(key);
                        }
                        anchor = key;
                    } else if (event?.shiftKey && anchor && items.has(anchor)) {
                        const order = [...items.keys()];
                        const a = order.indexOf(anchor);
                        const b = order.indexOf(key);
                        for (let i = Math.min(a, b); i <= Math.max(a, b); ++i) {
                            marked.add(order[i]);
                        }
                    } else {
                        marked.clear();
                        marked.add(key);
                        anchor = key;
                    }
                    notifyMarked();
                    if (soloMode && !key.visible) {
                        key.visible = true;
                    }
                    events.fire('selection', key);
                    break;
                }
            }
        });

        this.on('removeClicked', async (item: SplatItem) => {
            let splat;
            for (const [key, value] of items) {
                if (item === value) {
                    splat = key;
                    break;
                }
            }

            if (!splat) {
                return;
            }

            const result = await events.invoke('showPopup', {
                type: 'yesno',
                header: 'Remove Splat',
                message: `Are you sure you want to remove '${splat.name}' from the scene? This operation can not be undone.`
            });

            if (result?.action === 'yes') {
                splat.destroy();
            }
        });
    }

    protected _onAppendChild(element: PcuiElement): void {
        super._onAppendChild(element);

        if (element instanceof SplatItem) {
            // [custom] the DOM event travels along so the list can read the
            // Ctrl / Shift modifiers (layer marks)
            element.dom.addEventListener('click', (event: MouseEvent) => {
                this.emit('click', element, event);
            });

            element.on('removeClicked', () => {
                this.emit('removeClicked', element);
            });
        }
    }

    protected _onRemoveChild(element: PcuiElement): void {
        if (element instanceof SplatItem) {
            element.unbind('click');
            element.unbind('removeClicked');
        }

        super._onRemoveChild(element);
    }
}

export { SplatList, SplatItem };
