// [custom] Electron main process for the SuperSplat desktop build.
//
// Layout: electron/dist/main.js (this file, compiled) -> ../../dist (rollup output)
//
// Command line: any existing file argument with a loadable extension is handed
// to the renderer through the app:// scheme (`?load=` params, which upstream
// already supports) — the headless way to open files without native pickers.
// `--enable-logging` (or SS_DESKTOP_LOG=1) also mirrors the renderer console
// to stdout, which is what the round-trip harness reads.

import fs from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import { installDevicePolicies } from './hid';
import { appUrl, installAppProtocol, registerAppScheme, registerFile } from './protocol';

const DIST_DIR = path.join(__dirname, '..', '..', 'dist');
const ICON = path.join(DIST_DIR, 'static', 'icons', 'logo-512.png');
const LOADABLE = new Set(['.ply', '.sog', '.spz', '.splat', '.ksplat', '.ssproj', '.json', '.txt', '.abc', '.zip']);
// --log-file=<path> appends renderer console + shell diagnostics to a file
// (stdout piping through npx/grep buffers; a file is what the harness reads).
const LOG_FILE = process.argv.find(arg => arg.startsWith('--log-file='))?.slice('--log-file='.length) ?? process.env.SS_DESKTOP_LOG_FILE;
const LOG_RENDERER = process.argv.includes('--enable-logging') || !!process.env.SS_DESKTOP_LOG || !!LOG_FILE;

let mainWindow: BrowserWindow | null = null;

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url);

const log = (line: string) => {
    console.log(line);
    if (LOG_FILE) {
        try {
            fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
        } catch {
            // logging must never take the app down
        }
    }
};

const collectFileArgs = (argv: string[]) => {
    return argv
    .filter(arg => !arg.startsWith('-') && LOADABLE.has(path.extname(arg).toLowerCase()))
    .map(arg => path.resolve(arg))
    .filter(file => fs.existsSync(file));
};

const loadUrlFor = (files: string[]) => {
    const url = new URL(appUrl('/'));
    for (const file of files) {
        const entry = registerFile(file);
        url.searchParams.append('load', entry.url);
        url.searchParams.append('filename', entry.filename);
    }
    return url.toString();
};

const createMenu = (win: BrowserWindow) => {
    const template: MenuItemConstructorOptions[] = [
        {
            label: 'SuperSplat',
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Reload', accelerator: 'F5', click: () => win.webContents.reload() },
                { label: 'Toggle Developer Tools', accelerator: 'F12', click: () => win.webContents.toggleDevTools() },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const attachDiagnostics = (win: BrowserWindow) => {
    if (LOG_RENDERER) {
        // Electron >= 32 passes a single details event; older versions pass
        // positional args. Handle both.
        win.webContents.on('console-message', (event: any, ...args: any[]) => {
            const level = event?.level ?? args[0];
            const message = event?.message ?? args[1];
            const line = event?.lineNumber ?? args[2];
            const source = event?.sourceId ?? args[3];
            log(`[renderer:${level}] ${message} (${source}:${line})`);
        });
    }
    win.webContents.on('did-finish-load', () => log(`[shell] did-finish-load ${win.webContents.getURL()}`));
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
        log(`[shell] did-fail-load ${code} ${description} ${url}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        log(`[shell] render-process-gone ${details.reason} (exit ${details.exitCode})`);
    });
    win.on('unresponsive', () => log('[shell] renderer unresponsive'));
};

const createWindow = (files: string[]) => {
    const win = new BrowserWindow({
        width: 1600,
        height: 1000,
        minWidth: 1024,
        minHeight: 640,
        backgroundColor: '#1a1a1a',
        title: 'SuperSplat Desktop',
        icon: ICON,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false
        }
    });

    win.once('ready-to-show', () => win.show());

    // external links open in the system browser; the shell never navigates away
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isHttpUrl(url)) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(appUrl())) {
            event.preventDefault();
            if (isHttpUrl(url)) {
                shell.openExternal(url);
            }
        }
    });

    win.on('closed', () => {
        mainWindow = null;
    });

    attachDiagnostics(win);
    createMenu(win);
    win.loadURL(loadUrlFor(files));

    return win;
};

const registerIpc = () => {
    ipcMain.handle('app:info', () => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform
    }));

    ipcMain.handle('shell:open', (_event, url: unknown) => {
        if (typeof url === 'string' && isHttpUrl(url)) {
            return shell.openExternal(url);
        }
        return undefined;
    });
};

registerAppScheme();

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv, workingDirectory) => {
        if (!mainWindow) {
            return;
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();

        const files = collectFileArgs(argv.map(arg => (path.isAbsolute(arg) ? arg : path.join(workingDirectory, arg))));
        if (files.length) {
            mainWindow.webContents.send('ss:open-files', files.map(registerFile));
        }
    });

    app.whenReady().then(() => {
        installAppProtocol(DIST_DIR);
        installDevicePolicies(session.defaultSession, appUrl(''));
        registerIpc();
        mainWindow = createWindow(collectFileArgs(process.argv));

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                mainWindow = createWindow([]);
            }
        });
    });

    app.on('window-all-closed', () => {
        app.quit();
    });
}
