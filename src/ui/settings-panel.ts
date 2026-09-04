import { BooleanInput, Button, Container, Label, SelectInput, SliderInput } from '@playcanvas/pcui';

import { Events } from '../events';
import { i18n } from './localization';
import resetSvg from './svg/reset.svg';
import { Tooltips } from './tooltips';

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement;
};

// application preferences: set-and-forget options, as opposed to the viewport
// state that lives in the appearance and overlays panels
class SettingsPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'settings-panel',
            class: ['panel', 'options-panel'],
            hidden: true
        };

        super(args);

        // stop pointer events bubbling
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        // header

        const header = new Container({
            class: 'panel-header'
        });

        const icon = new Label({
            text: '\uE283',
            class: 'panel-header-icon'
        });

        const label = new Label({
            class: 'panel-header-label'
        });
        i18n.bindText(label, 'panel.settings');

        const resetButton = new Container({
            class: ['panel-header-button', 'panel-header-reset-button']
        });
        resetButton.dom.appendChild(createSvg(resetSvg));
        resetButton.dom.setAttribute('role', 'button');
        resetButton.dom.setAttribute('tabindex', '0');
        i18n.onChange(() => resetButton.dom.setAttribute('aria-label', i18n.t('panel.settings.reset')), resetButton);
        resetButton.dom.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                resetButton.dom.click();
            }
        });

        header.append(icon);
        header.append(label);
        header.append(resetButton);

        // section bars share the panel-header styling, like the scene
        // manager's transform header
        const sectionHeader = (key: string) => {
            const section = new Container({
                class: ['panel-header', 'options-panel-section']
            });
            const sectionLabel = new Label({
                class: 'panel-header-label'
            });
            i18n.bindText(sectionLabel, key);
            section.append(sectionLabel);
            return section;
        };

        // toggle rows flip on a click anywhere in the row, not just the switch
        const rowToggles = (row: Container, toggle: BooleanInput) => {
            row.class.add('options-panel-row-clickable');
            row.dom.addEventListener('click', (event: MouseEvent) => {
                if (toggle.enabled && !toggle.dom.contains(event.target as Node)) {
                    toggle.value = !toggle.value;
                }
            });
        };

        // language

        const languageRow = new Container({
            class: 'settings-panel-row'
        });

        const languageLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(languageLabel, 'panel.settings.language');

        const languageSelection = new SelectInput({
            class: 'settings-panel-row-select',
            // 'auto' unless the user has explicitly pinned a language
            defaultValue: i18n.storedLanguage ?? 'auto'
        });
        // 'auto' label follows the language; the per-language names are shown in
        // their native form so they're recognisable regardless of current UI lang
        i18n.bindOptions(languageSelection, () => [
            { v: 'auto', t: i18n.t('panel.settings.language.auto') },
            ...i18n.languages.map(l => ({ v: l.code, t: l.name }))
        ]);

        // switch language live (no reload). a stored choice persists across
        // sessions; 'auto' clears it and reverts to the browser locale.
        languageSelection.on('change', (value: string) => {
            i18n.setLanguage(value === 'auto' ? null : value);
        });

        languageRow.append(languageLabel);
        languageRow.append(languageSelection);

        // tonemapping

        const tonemappingRow = new Container({
            class: 'settings-panel-row'
        });

        const tonemappingLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(tonemappingLabel, 'panel.settings.tone-mapping');

        const tonemappingSelection = new SelectInput({
            class: 'settings-panel-row-select',
            defaultValue: 'linear'
        });
        i18n.bindOptions(tonemappingSelection, () => [
            { v: 'linear', t: i18n.t('panel.settings.tone-mapping.linear') },
            { v: 'neutral', t: i18n.t('panel.settings.tone-mapping.neutral') },
            { v: 'aces', t: i18n.t('panel.settings.tone-mapping.aces') },
            { v: 'aces2', t: i18n.t('panel.settings.tone-mapping.aces2') },
            { v: 'filmic', t: i18n.t('panel.settings.tone-mapping.filmic') },
            { v: 'hejl', t: i18n.t('panel.settings.tone-mapping.hejl') }
        ]);

        tonemappingRow.append(tonemappingLabel);
        tonemappingRow.append(tonemappingSelection);

        // camera fov

        const fovRow = new Container({
            class: 'settings-panel-row'
        });

        const fovLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(fovLabel, 'panel.settings.fov');

        const fovSlider = new SliderInput({
            class: 'settings-panel-row-slider',
            min: 10,
            max: 120,
            precision: 1,
            value: 60
        });

        fovRow.append(fovLabel);
        fovRow.append(fovSlider);

        // fov auto dolly

        const fovDollyRow = new Container({
            class: 'settings-panel-row'
        });

        const fovDollyLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(fovDollyLabel, 'panel.settings.fov-dolly');

        const fovDollyToggle = new BooleanInput({
            type: 'toggle',
            class: 'settings-panel-row-toggle',
            value: false
        });

        fovDollyRow.append(fovDollyLabel);
        fovDollyRow.append(fovDollyToggle);

        // sh bands
        const shBandsRow = new Container({
            class: 'settings-panel-row'
        });

        const shBandsLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(shBandsLabel, 'panel.settings.sh-bands');

        const shBandsSlider = new SliderInput({
            class: 'settings-panel-row-slider',
            min: 0,
            max: 3,
            precision: 0,
            value: 3
        });

        shBandsRow.append(shBandsLabel);
        shBandsRow.append(shBandsSlider);

        // camera fly speed

        const cameraFlySpeedRow = new Container({
            class: 'settings-panel-row'
        });

        const cameraFlySpeedLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(cameraFlySpeedLabel, 'panel.settings.fly-speed');

        const cameraFlySpeedSlider = new SliderInput({
            class: 'settings-panel-row-slider',
            min: 0.1,
            max: 30,
            precision: 1,
            value: 1
        });

        cameraFlySpeedRow.append(cameraFlySpeedLabel);
        cameraFlySpeedRow.append(cameraFlySpeedSlider);

        // stochastic alpha

        const stochasticRow = new Container({
            class: 'settings-panel-row'
        });

        const stochasticLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(stochasticLabel, 'panel.settings.stochastic-alpha');

        const stochasticSelection = new SelectInput({
            class: 'settings-panel-row-select',
            defaultValue: 'auto'
        });
        i18n.bindOptions(stochasticSelection, () => [
            { v: 'disabled', t: i18n.t('panel.settings.stochastic-alpha.disabled') },
            { v: 'enabled', t: i18n.t('panel.settings.stochastic-alpha.enabled') },
            { v: 'movement', t: i18n.t('panel.settings.stochastic-alpha.movement') },
            { v: 'auto', t: i18n.t('panel.settings.stochastic-alpha.auto') }
        ]);

        stochasticRow.append(stochasticLabel);
        stochasticRow.append(stochasticSelection);

        // [custom] SpaceMouse (src/spacemouse). Defaults mirror SpaceMouseTuning:
        // preferences only notify on change, so unchanged stored values never reach the UI.

        const spaceMouseAvailable = !!events.invoke('spacemouse.available');

        const spaceMouseStatusRow = new Container({
            class: 'settings-panel-row'
        });

        const spaceMouseStatusLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(spaceMouseStatusLabel, 'panel.settings.spacemouse-device');

        const spaceMouseStatus = new Label({
            class: 'settings-panel-row-label'
        });

        const spaceMouseConnectButton = new Button({
            class: 'settings-panel-row-button'
        });
        i18n.bindText(spaceMouseConnectButton, 'panel.settings.spacemouse-connect');

        spaceMouseStatusRow.append(spaceMouseStatusLabel);
        spaceMouseStatusRow.append(spaceMouseStatus);
        spaceMouseStatusRow.append(spaceMouseConnectButton);

        const spaceMouseEnabledRow = new Container({
            class: 'settings-panel-row'
        });

        const spaceMouseEnabledLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(spaceMouseEnabledLabel, 'panel.settings.spacemouse-enabled');

        const spaceMouseEnabledToggle = new BooleanInput({
            type: 'toggle',
            class: 'settings-panel-row-toggle',
            value: true
        });

        spaceMouseEnabledRow.append(spaceMouseEnabledLabel);
        spaceMouseEnabledRow.append(spaceMouseEnabledToggle);

        const spaceMouseScaleRow = new Container({
            class: 'settings-panel-row'
        });

        const spaceMouseScaleLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(spaceMouseScaleLabel, 'panel.settings.spacemouse-sensitivity');

        const spaceMouseScaleSlider = new SliderInput({
            class: 'settings-panel-row-slider',
            min: 0.1,
            max: 10,
            precision: 2,
            value: 1
        });

        spaceMouseScaleRow.append(spaceMouseScaleLabel);
        spaceMouseScaleRow.append(spaceMouseScaleSlider);

        const spaceMouseDeadzoneRow = new Container({
            class: 'settings-panel-row'
        });

        const spaceMouseDeadzoneLabel = new Label({
            class: 'settings-panel-row-label'
        });
        i18n.bindText(spaceMouseDeadzoneLabel, 'panel.settings.spacemouse-deadzone');

        const spaceMouseDeadzoneSlider = new SliderInput({
            class: 'settings-panel-row-slider',
            min: 0,
            max: 0.5,
            precision: 2,
            value: 0.03
        });

        spaceMouseDeadzoneRow.append(spaceMouseDeadzoneLabel);
        spaceMouseDeadzoneRow.append(spaceMouseDeadzoneSlider);

        // per-axis invert flags: three labelled toggles per row (translation, rotation)
        const invertRow = (key: string, axisNames: string[]) => {
            const row = new Container({
                class: 'settings-panel-row'
            });
            const label = new Label({
                class: 'settings-panel-row-label'
            });
            i18n.bindText(label, key);
            const group = new Container();
            group.dom.style.display = 'flex';
            group.dom.style.alignItems = 'center';
            group.dom.style.gap = '6px';
            const toggles = axisNames.map((axisName) => {
                const axisLabel = new Label({ text: axisName });
                axisLabel.dom.style.opacity = '0.7';
                const toggle = new BooleanInput({
                    type: 'toggle',
                    class: 'settings-panel-row-toggle',
                    value: false
                });
                group.append(axisLabel);
                group.append(toggle);
                return toggle;
            });
            row.append(label);
            row.append(group);
            return { row, toggles };
        };

        const spaceMouseInvertTranslation = invertRow('panel.settings.spacemouse-invert-translation', ['X', 'Y', 'Z']);
        const spaceMouseInvertRotation = invertRow('panel.settings.spacemouse-invert-rotation', ['X', 'Y', 'Z']);
        const spaceMouseInvertToggles = [...spaceMouseInvertTranslation.toggles, ...spaceMouseInvertRotation.toggles];

        rowToggles(fovDollyRow, fovDollyToggle);
        rowToggles(spaceMouseEnabledRow, spaceMouseEnabledToggle);

        this.append(header);
        this.append(languageRow);
        this.append(sectionHeader('panel.settings.section-rendering'));
        this.append(stochasticRow);
        this.append(tonemappingRow);
        this.append(shBandsRow);
        this.append(sectionHeader('panel.settings.section-camera'));
        this.append(cameraFlySpeedRow);
        this.append(fovRow);
        this.append(fovDollyRow);
        // [custom]
        this.append(sectionHeader('panel.settings.section-spacemouse'));
        this.append(spaceMouseStatusRow);
        this.append(spaceMouseEnabledRow);
        this.append(spaceMouseScaleRow);
        this.append(spaceMouseDeadzoneRow);
        this.append(spaceMouseInvertTranslation.row);
        this.append(spaceMouseInvertRotation.row);

        // handle panel visibility

        const setVisible = (visible: boolean) => {
            if (visible === this.hidden) {
                this.hidden = !visible;
                events.fire('settingsPanel.visible', visible);
            }
        };

        events.function('settingsPanel.visible', () => {
            return !this.hidden;
        });

        events.on('settingsPanel.setVisible', (visible: boolean) => {
            setVisible(visible);
        });

        events.on('settingsPanel.toggleVisible', () => {
            setVisible(this.hidden);
        });

        events.on('overlaysPanel.visible', (visible: boolean) => {
            if (visible) {
                setVisible(false);
            }
        });

        events.on('appearancePanel.visible', (visible: boolean) => {
            if (visible) {
                setVisible(false);
            }
        });

        // sh bands

        events.on('view.bands', (bands: number) => {
            shBandsSlider.value = bands;
        });

        shBandsSlider.on('change', (value: number) => {
            events.fire('view.setBands', value);
        });

        // camera speed

        events.on('camera.flySpeed', (value: number) => {
            cameraFlySpeedSlider.value = value;
        });

        cameraFlySpeedSlider.on('change', (value: number) => {
            events.fire('camera.setFlySpeed', value);
        });

        // fov auto dolly

        events.on('camera.fovDolly', (value: boolean) => {
            fovDollyToggle.value = value;
        });

        fovDollyToggle.on('change', (value: boolean) => {
            events.fire('camera.setFovDolly', value);
        });

        // stochastic alpha

        events.on('view.stochastic', (value: string) => {
            stochasticSelection.value = value;
        });

        stochasticSelection.on('change', (value: string) => {
            events.fire('view.setStochastic', value);
        });

        // camera fov

        events.on('camera.fov', (fov: number) => {
            fovSlider.value = fov;
        });

        fovSlider.on('change', (value: number) => {
            events.fire('camera.setFov', value);
        });

        // tonemapping

        events.on('camera.tonemapping', (tonemapping: string) => {
            tonemappingSelection.value = tonemapping;
        });

        tonemappingSelection.on('change', (value: string) => {
            events.fire('camera.setTonemapping', value);
        });

        // [custom] spacemouse

        const updateSpaceMouseStatus = () => {
            const connected = spaceMouseAvailable && !!events.invoke('spacemouse.connected');
            if (!spaceMouseAvailable) {
                spaceMouseStatus.text = i18n.t('panel.settings.spacemouse-status.unavailable');
            } else if (connected) {
                spaceMouseStatus.text = i18n.t('panel.settings.spacemouse-status.connected', { name: events.invoke('spacemouse.deviceName') });
            } else {
                spaceMouseStatus.text = i18n.t('panel.settings.spacemouse-status.disconnected');
            }
            spaceMouseConnectButton.hidden = !spaceMouseAvailable || connected;
        };
        i18n.onChange(updateSpaceMouseStatus, spaceMouseStatus);
        events.on('spacemouse.connected', updateSpaceMouseStatus);

        spaceMouseConnectButton.on('click', () => {
            events.fire('spacemouse.connect');
        });

        events.on('spacemouse.enabled', (value: boolean) => {
            spaceMouseEnabledToggle.value = value;
        });

        spaceMouseEnabledToggle.on('change', (value: boolean) => {
            events.fire('spacemouse.setEnabled', value);
        });

        events.on('spacemouse.scale', (value: number) => {
            spaceMouseScaleSlider.value = value;
        });

        spaceMouseScaleSlider.on('change', (value: number) => {
            events.fire('spacemouse.setScale', value);
        });

        events.on('spacemouse.deadzone', (value: number) => {
            spaceMouseDeadzoneSlider.value = value;
        });

        spaceMouseDeadzoneSlider.on('change', (value: number) => {
            events.fire('spacemouse.setDeadzone', value);
        });

        events.on('spacemouse.invert', (flags: boolean[]) => {
            flags.forEach((flag, i) => {
                spaceMouseInvertToggles[i].value = flag;
            });
        });

        spaceMouseInvertToggles.forEach((toggle) => {
            toggle.on('change', () => {
                events.fire('spacemouse.setInvert', spaceMouseInvertToggles.map(t => !!t.value));
            });
        });

        // reset preferences

        resetButton.on('click', () => {
            events.fire('preferences.reset', 'preferences');
        });

        // reset reverts language to automatic; sync the selector (its change
        // handler makes the equivalent setLanguage(null) call idempotently)
        events.on('preferences.reset', (group?: string) => {
            if (!group || group === 'preferences') {
                languageSelection.value = 'auto';
            }
        });

        // tooltips
        tooltips.register(resetButton, () => i18n.t('panel.settings.reset'), 'left');
    }
}

export { SettingsPanel };
