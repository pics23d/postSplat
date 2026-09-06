// [custom] Typed view of the preload bridge (electron/preload.ts). Keep in sync.
//
// Renderer code checks `isDesktop()` to swap browser-only flows (superspl.at
// cookie publish) for desktop ones; everything else must keep working in a
// plain browser build.

export type DesktopProgress = {
    task: string;
    text?: string;
    /** 0..1 */
    progress: number;
};

export type DesktopInfo = {
    version: string;
    electron: string;
    chrome: string;
    node: string;
    platform: string;
};

export type DesktopFile = {
    filename: string;
    /** app://editor/__file/... url the renderer can fetch */
    url: string;
};

export type DesktopPathFile = DesktopFile & {
    /** absolute path on disk; the shell only writes to paths it handed out */
    path: string;
};

export type DesktopAcceptType = { description?: string, accept?: Record<string, string[]> };

export interface DesktopBridge {
    info(): Promise<DesktopInfo>;
    openExternal(url: string): Promise<void>;
    onProgress(callback: (progress: DesktopProgress) => void): () => void;
    onOpenFiles(callback: (files: DesktopFile[]) => void): () => void;

    // native file dialogs + streamed writes (electron/files.ts); defaults follow
    // the last directory used per kind, else the last opened file's directory
    showOpenDialog(options: { kind: 'import' | 'document', multiple?: boolean, types?: DesktopAcceptType[] }): Promise<DesktopPathFile[]>;
    showSaveDialog(options: { kind: 'save' | 'export', suggestedName?: string, types?: DesktopAcceptType[] }): Promise<DesktopPathFile | null>;
    resolveRecent(path: string): Promise<DesktopPathFile | null>;
    openWrite(path: string): Promise<number>;
    write(token: number, chunk: Uint8Array, position: number): Promise<void>;
    truncate(token: number, size: number): Promise<void>;
    closeWrite(token: number): Promise<void>;
    abortWrite(token: number): Promise<void>;
    removeFile(path: string): Promise<void>;
}

declare global {
    interface Window {
        ssDesktop?: DesktopBridge;
    }
}

export const desktop = (): DesktopBridge | null => window.ssDesktop ?? null;

export const isDesktop = () => !!window.ssDesktop;
