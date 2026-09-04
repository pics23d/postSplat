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

export interface DesktopBridge {
    info(): Promise<DesktopInfo>;
    openExternal(url: string): Promise<void>;
    onProgress(callback: (progress: DesktopProgress) => void): () => void;
    onOpenFiles(callback: (files: DesktopFile[]) => void): () => void;
}

declare global {
    interface Window {
        ssDesktop?: DesktopBridge;
    }
}

export const desktop = (): DesktopBridge | null => window.ssDesktop ?? null;

export const isDesktop = () => !!window.ssDesktop;
