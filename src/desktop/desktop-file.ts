// [custom] File System Access look-alikes backed by the desktop shell.
//
// Upstream opens and saves through window.showOpenFilePicker /
// showSaveFilePicker and writes through FileSystemWritableFileStream. The
// desktop build swaps the pickers for the shell's native dialogs (which know
// the directories to default to, see electron/files.ts) and returns handles
// with the same surface, so the upstream call sites stay one-line hooks:
//
//   const handle = await (isDesktop() ? desktopShowSaveFilePicker('export', opts) : window.showSaveFilePicker(opts));
//
// Cancelling throws the same AbortError DOMException the browser pickers do.
// Handles survive IndexedDB (recent files) as plain {kind, name, path} records;
// restoreDesktopHandle() turns such a record back into a live handle.

import { desktop, DesktopAcceptType, DesktopPathFile } from './bridge';

// structured clone of a Uint8Array copies its whole underlying buffer, so each
// IPC message carries an exact-size copy; large writes go in slices
const WRITE_SLICE = 16 * 1024 * 1024;

type Bytes = ArrayBuffer | ArrayBufferView;

type WriteChunk =
    | Bytes | Blob | string
    | { type: 'write', data: Bytes | Blob | string, position?: number }
    | { type: 'seek', position: number }
    | { type: 'truncate', size: number };

const toBytes = async (data: Bytes | Blob | string): Promise<Uint8Array> => {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new TypeError('unsupported write chunk');
};

const abortError = () => new DOMException('The user aborted a request.', 'AbortError');

class DesktopWritableStream extends WritableStream<WriteChunk> {
    constructor(token: number) {
        const bridge = desktop();
        let position = 0;
        super({
            write: async (chunk) => {
                let data: Bytes | Blob | string;
                if (chunk && typeof chunk === 'object' && 'type' in chunk && !(chunk instanceof Blob) && !ArrayBuffer.isView(chunk) && !(chunk instanceof ArrayBuffer)) {
                    if (chunk.type === 'seek') {
                        position = chunk.position;
                        return;
                    }
                    if (chunk.type === 'truncate') {
                        await bridge.truncate(token, chunk.size);
                        position = Math.min(position, chunk.size);
                        return;
                    }
                    if (chunk.position !== undefined) {
                        position = chunk.position;
                    }
                    data = chunk.data;
                } else {
                    data = chunk as Bytes | Blob | string;
                }
                const bytes = await toBytes(data);
                for (let offset = 0; offset < bytes.length; offset += WRITE_SLICE) {
                    const slice = bytes.slice(offset, Math.min(bytes.length, offset + WRITE_SLICE));
                    await bridge.write(token, slice, position);
                    position += slice.length;
                }
            },
            close: () => bridge.closeWrite(token),
            abort: () => bridge.abortWrite(token)
        });
    }

    // FileSystemWritableFileStream conveniences on top of the WritableStream
    private async through(chunk: WriteChunk) {
        const writer = this.getWriter();
        try {
            await writer.write(chunk);
        } finally {
            writer.releaseLock();
        }
    }

    write(data: WriteChunk) {
        return this.through(data);
    }

    seek(position: number) {
        return this.through({ type: 'seek', position });
    }

    truncate(size: number) {
        return this.through({ type: 'truncate', size });
    }
}

class DesktopFileHandle {
    readonly kind = 'file' as const;
    readonly name: string;
    readonly path: string;
    // registered app:// url for reading; per process, re-resolved for recents
    readonly url: string;

    constructor(file: DesktopPathFile) {
        this.name = file.filename;
        this.path = file.path;
        this.url = file.url;
    }

    async getFile(): Promise<File> {
        const response = await fetch(this.url);
        if (!response.ok) {
            throw new Error(`failed to read ${this.name} (${response.status})`);
        }
        return new File([await response.blob()], this.name);
    }

    async createWritable(): Promise<FileSystemWritableFileStream> {
        const token = await desktop().openWrite(this.path);
        return new DesktopWritableStream(token) as unknown as FileSystemWritableFileStream;
    }

    remove() {
        return desktop().removeFile(this.path);
    }

    isSameEntry(other: unknown) {
        return Promise.resolve(other instanceof DesktopFileHandle && other.path === this.path);
    }

    queryPermission() {
        return Promise.resolve('granted' as const);
    }

    requestPermission() {
        return Promise.resolve('granted' as const);
    }
}

// a recent-files record (structured clone of a handle) from this or an earlier
// run; null when the shell no longer vouches for the path
const restoreDesktopHandle = async (record: unknown): Promise<DesktopFileHandle | null> => {
    if (record instanceof DesktopFileHandle) {
        return record;
    }
    const path = (record as { path?: unknown })?.path;
    if (typeof path !== 'string') {
        return null;
    }
    const file = await desktop().resolveRecent(path);
    return file ? new DesktopFileHandle(file) : null;
};

const isDesktopRecord = (record: unknown) => typeof (record as { path?: unknown })?.path === 'string';

const desktopShowOpenFilePicker = async (kind: 'import' | 'document', options: { multiple?: boolean, types?: DesktopAcceptType[] } = {}) => {
    const files = await desktop().showOpenDialog({ kind, multiple: options.multiple, types: options.types });
    if (!files.length) {
        throw abortError();
    }
    return files.map(file => new DesktopFileHandle(file));
};

const desktopShowSaveFilePicker = async (kind: 'save' | 'export', options: { suggestedName?: string, types?: DesktopAcceptType[] } = {}) => {
    const file = await desktop().showSaveDialog({ kind, suggestedName: options.suggestedName, types: options.types });
    if (!file) {
        throw abortError();
    }
    return new DesktopFileHandle(file);
};

export { DesktopFileHandle, DesktopWritableStream, desktopShowOpenFilePicker, desktopShowSaveFilePicker, restoreDesktopHandle, isDesktopRecord };
