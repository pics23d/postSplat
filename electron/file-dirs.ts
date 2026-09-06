// [custom] Remembered directories for the desktop file dialogs (user CR
// 2026-09-06): Save and Export each default to the directory they last used;
// until they have one, both default to the directory of the last file the user
// opened (command line, second instance, Open / Import dialogs).
//
// Pure module (no electron import) so node:test can cover it: the shell passes
// the storage file path in.

import fs from 'node:fs';
import path from 'node:path';

export type DialogKind = 'import' | 'save' | 'export';

type Stored = {
    import?: string;
    save?: string;
    export?: string;
    // files the user has opened or saved through the shell, newest first;
    // recent-file entries may only be re-registered from this list
    known?: string[];
};

const KNOWN_LIMIT = 200;

const isDir = (dir: string | undefined): dir is string => {
    try {
        return !!dir && fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
};

export class FileDirs {
    private readonly file: string;
    private state: Stored = {};

    constructor(storageFile: string) {
        this.file = storageFile;
        try {
            const parsed = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
            if (parsed && typeof parsed === 'object') {
                this.state = {
                    import: typeof parsed.import === 'string' ? parsed.import : undefined,
                    save: typeof parsed.save === 'string' ? parsed.save : undefined,
                    export: typeof parsed.export === 'string' ? parsed.export : undefined,
                    known: Array.isArray(parsed.known) ? parsed.known.filter((p: unknown) => typeof p === 'string') : []
                };
            }
        } catch {
            // first launch or unreadable file
        }
    }

    // the directory a dialog of this kind should open in; undefined lets the
    // OS choose. Directories that no longer exist are skipped.
    defaultDir(kind: DialogKind): string | undefined {
        const own = this.state[kind];
        if (isDir(own)) {
            return own;
        }
        return isDir(this.state.import) ? this.state.import : undefined;
    }

    // a file the user opened (any way): its directory becomes the import default
    noteOpened(file: string) {
        this.state.import = path.dirname(path.resolve(file));
        this.remember(file);
    }

    // a file the user saved or exported to
    noteSaved(kind: 'save' | 'export', file: string) {
        this.state[kind] = path.dirname(path.resolve(file));
        this.remember(file);
    }

    isKnown(file: string) {
        const resolved = path.resolve(file);
        return (this.state.known ?? []).some(p => p === resolved);
    }

    private remember(file: string) {
        const resolved = path.resolve(file);
        const known = (this.state.known ?? []).filter(p => p !== resolved);
        known.unshift(resolved);
        this.state.known = known.slice(0, KNOWN_LIMIT);
        this.flush();
    }

    private flush() {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
        } catch {
            // remembering directories must never take the app down
        }
    }
}
