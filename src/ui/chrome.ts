import { Events } from '../events';

// [custom] F1 cycles the editor chrome (user CR 2026-09-11, moved off Tab 2026-09-12):
//   level 0 = everything shown (default canvas)
//   level 1 = scene manager + menu collapsed (what the collapse button next to
//             Help does; body.collapsed)
//   level 2 = the bottom and right toolbars gone as well (body.chrome-hidden)
// The menu's collapse / arrow buttons drive the same state, so the button and
// the key never disagree. Session state only, nothing is persisted.
type ChromeLevel = 0 | 1 | 2;

const registerChromeEvents = (events: Events) => {
    let level: ChromeLevel = 0;

    const apply = () => {
        document.body.classList.toggle('collapsed', level >= 1);
        document.body.classList.toggle('chrome-hidden', level >= 2);
        // the first F1 closes the hint overlay too (user CR 2026-09-11);
        // same persisted state as Ctrl+H / the Hints button, so it stays
        // closed when the default canvas returns
        if (level > 0) {
            events.fire('hints.setVisible', false);
        }
        events.fire('ui.chrome', level);
    };

    events.function('ui.chrome', () => level);

    events.on('ui.setChrome', (value: number) => {
        const next = Math.max(0, Math.min(2, Math.round(value))) as ChromeLevel;
        if (next !== level) {
            level = next;
            apply();
        }
    });

    events.on('ui.cycleChrome', () => {
        events.fire('ui.setChrome', (level + 1) % 3);
    });
};

export { registerChromeEvents };
