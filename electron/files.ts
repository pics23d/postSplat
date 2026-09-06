// [custom] Desktop file dialogs and file writing for the renderer.
//
// Upstream uses the File System Access API (showSaveFilePicker & co). Under
// Electron those pickers cannot be pointed at a directory the shell knows
// (files opened from the command line have no handle), so the desktop build
// routes Open / Save / Export through native dialogs here and streams the
// written bytes over IPC. Defaults follow FileDirs (last used directory per
// kind, else the last opened file's directory).
//
// Writes go to a temp file next to the target and are renamed into place on
// close (abort discards them), which is the File System Access semantics the
// renderer's writers rely on. The renderer may only write to paths the shell
// handed to it (a dialog result, a command-line file, a validated recent file).
//
// Harness: `--test-dir=<dir>` bypasses the dialogs — save dialogs resolve to
// <dir>/<suggestedName>, open dialogs to the files in `--test-open=<a;b>` —
// and every dialog logs the default it would have used.

import fs from 'node:fs';
import path from 'node:path';

import { BrowserWindow, dialog, ipcMain } from 'electron';

import { FileDirs, DialogKind } from './file-dirs';
import { isRegisteredPath, registerFile } from './protocol';

type AcceptType = { description?: string, accept?: Record<string, string[]> };
type OpenOptions = { kind: 'import' | 'document', multiple?: boolean, types?: AcceptType[] };
type SaveOptions = { kind: 'save' | 'export', suggestedName?: string, types?: AcceptType[] };
type DesktopFile = { filename: string, url: string, path: string };

type Options = {
    storageFile: string;
    getWindow: () => BrowserWindow | null;
    log: (line: string) => void;
    testDir?: string;
    testOpen?: string[];
};

const toFilters = (types: AcceptType[] | undefined, allFiles: boolean) => {
    const filters: { name: string, extensions: string[] }[] = [];
    for (const type of types ?? []) {
        const extensions = Object.values(type.accept ?? {}).flat().map(ext => ext.replace(/^\./, ''));
        if (extensions.length) {
            filters.push({ name: type.description ?? extensions.join(', '), extensions });
        }
    }
    if (allFiles) {
        filters.push({ name: 'All Files', extensions: ['*'] });
    }
    return filters;
};

const toBuffer = (chunk: unknown): Buffer => {
    if (Buffer.isBuffer(chunk)) return chunk;
    if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
    throw new TypeError('file:write expects bytes');
};

export const installFileIpc = (options: Options) => {
    const dirs = new FileDirs(options.storageFile);
    const { log } = options;

    // paths the renderer may write to: everything registered this session
    const writable = (file: string) => isRegisteredPath(file);

    const entryFor = (file: string): DesktopFile => ({ ...registerFile(file), path: path.resolve(file) });

    const noteOpened = (files: string[]) => files.forEach(file => dirs.noteOpened(file));

    ipcMain.handle('file:showOpen', async (_event, raw: unknown): Promise<DesktopFile[]> => {
        const opts = (raw ?? {}) as OpenOptions;
        const kind: DialogKind = 'import';
        const defaultPath = dirs.defaultDir(kind);
        let files: string[];
        if (options.testDir) {
            files = (options.testOpen ?? []).filter(file => fs.existsSync(file));
        } else {
            const win = options.getWindow();
            const dialogOptions: Electron.OpenDialogOptions = {
                defaultPath,
                filters: toFilters(opts.types, true),
                properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile']
            };
            const result = await (win ? dialog.showOpenDialog(win, dialogOptions) : dialog.showOpenDialog(dialogOptions));
            files = result.canceled ? [] : result.filePaths;
        }
        log(`[shell] file dialog open (${opts.kind ?? 'import'}) default=${defaultPath ?? '-'} -> ${files.length ? files.join('; ') : 'cancelled'}`);
        noteOpened(files);
        return files.map(entryFor);
    });

    ipcMain.handle('file:showSave', async (_event, raw: unknown): Promise<DesktopFile | null> => {
        const opts = (raw ?? {}) as SaveOptions;
        const kind: 'save' | 'export' = opts.kind === 'save' ? 'save' : 'export';
        const suggested = opts.suggestedName || 'untitled';
        const dir = dirs.defaultDir(kind);
        const defaultPath = dir ? path.join(dir, suggested) : suggested;
        let file: string | null;
        if (options.testDir) {
            fs.mkdirSync(options.testDir, { recursive: true });
            file = path.join(options.testDir, suggested);
        } else {
            const win = options.getWindow();
            const dialogOptions: Electron.SaveDialogOptions = {
                defaultPath,
                filters: toFilters(opts.types, false),
                properties: ['showOverwriteConfirmation', 'createDirectory']
            };
            const result = await (win ? dialog.showSaveDialog(win, dialogOptions) : dialog.showSaveDialog(dialogOptions));
            file = result.canceled || !result.filePath ? null : result.filePath;
        }
        log(`[shell] file dialog ${kind} default=${defaultPath} -> ${file ?? 'cancelled'}`);
        if (!file) {
            return null;
        }
        dirs.noteSaved(kind, file);
        return entryFor(file);
    });

    // a recent-files entry from an earlier run: re-register it if the user
    // really opened or saved it through the shell before and it still exists
    ipcMain.handle('file:resolveRecent', (_event, file: unknown): DesktopFile | null => {
        if (typeof file !== 'string' || !dirs.isKnown(file) || !fs.existsSync(file)) {
            return null;
        }
        dirs.noteOpened(file);
        return entryFor(file);
    });

    // streamed writes: token -> open temp file
    type Open = { target: string, temp: string, handle: fs.promises.FileHandle };
    const opens = new Map<number, Open>();
    let nextToken = 1;

    ipcMain.handle('file:openWrite', async (_event, file: unknown): Promise<number> => {
        if (typeof file !== 'string' || !writable(file)) {
            throw new Error('file:openWrite: path was not handed out by the shell');
        }
        const target = path.resolve(file);
        const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${nextToken}.part`);
        const handle = await fs.promises.open(temp, 'w');
        const token = nextToken++;
        opens.set(token, { target, temp, handle });
        return token;
    });

    const open = (token: unknown) => {
        const entry = opens.get(token as number);
        if (!entry) {
            throw new Error('file:write: unknown token');
        }
        return entry;
    };

    ipcMain.handle('file:write', async (_event, token: unknown, chunk: unknown, position: unknown) => {
        const entry = open(token);
        const buffer = toBuffer(chunk);
        let offset = 0;
        let at = typeof position === 'number' ? position : null;
        while (offset < buffer.length) {
            const { bytesWritten } = await entry.handle.write(buffer, offset, buffer.length - offset, at);
            offset += bytesWritten;
            if (at !== null) at += bytesWritten;
        }
    });

    ipcMain.handle('file:truncate', async (_event, token: unknown, size: unknown) => {
        await open(token).handle.truncate(typeof size === 'number' ? size : 0);
    });

    ipcMain.handle('file:closeWrite', async (_event, token: unknown) => {
        const entry = open(token);
        opens.delete(token as number);
        await entry.handle.close();
        await fs.promises.rename(entry.temp, entry.target);
    });

    ipcMain.handle('file:abortWrite', async (_event, token: unknown) => {
        const entry = opens.get(token as number);
        if (!entry) return;
        opens.delete(token as number);
        await entry.handle.close();
        await fs.promises.rm(entry.temp, { force: true });
    });

    // upstream removes the empty file a failed image / video render left behind
    ipcMain.handle('file:remove', async (_event, file: unknown) => {
        if (typeof file !== 'string' || !writable(file)) {
            throw new Error('file:remove: path was not handed out by the shell');
        }
        await fs.promises.rm(file, { force: true });
    });

    return {
        // command-line and second-instance files count as opened
        noteOpened
    };
};
