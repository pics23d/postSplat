// [custom] Preload: the only surface the renderer gets from the desktop shell.
// Typed on the renderer side in src/desktop/bridge.ts — keep both in sync.

import { contextBridge, ipcRenderer } from 'electron';

type ProgressCallback = (progress: { task: string, text?: string, progress: number }) => void;
type OpenFilesCallback = (files: { filename: string, url: string }[]) => void;

const subscribe = <T>(channel: string, callback: (payload: T) => void) => {
    const listener = (_event: unknown, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
};

const api = {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
    onProgress: (callback: ProgressCallback) => subscribe('ss:progress', callback),
    // files passed to a second instance (double-click / "open with") while running
    onOpenFiles: (callback: OpenFilesCallback) => subscribe('ss:open-files', callback)
};

contextBridge.exposeInMainWorld('ssDesktop', api);
