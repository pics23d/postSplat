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

import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import { installFileIpc } from './files';
import { installDevicePolicies } from './hid';
import { appUrl, installAppProtocol, registerAppScheme, registerFile } from './protocol';

const DIST_DIR = path.join(__dirname, '..', '..', 'dist');
const ICON = path.join(DIST_DIR, 'static', 'icons', 'logo-512.png');
const LOADABLE = new Set(['.ply', '.sog', '.spz', '.splat', '.ksplat', '.ssproj', '.json', '.txt', '.abc', '.zip']);
const argValue = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
// --log-file=<path> appends renderer console + shell diagnostics to a file
// (stdout piping through npx/grep buffers; a file is what the harness reads).
const LOG_FILE = argValue('log-file') ?? process.env.SS_DESKTOP_LOG_FILE;
const LOG_RENDERER = process.argv.includes('--enable-logging') || !!process.env.SS_DESKTOP_LOG || !!LOG_FILE;
// harness: --user-data-dir=<dir> keeps test runs away from the user's state,
// --test-dir=<dir> / --test-open=<a;b> replace the native file dialogs (files.ts)
const USER_DATA_DIR = argValue('user-data-dir');
const TEST_DIR = argValue('test-dir');
const TEST_OPEN = argValue('test-open')?.split(';').filter(Boolean);

// a harness profile still opens where the user keeps the app: its window
// state falls back to the default profile's (user request 2026-09-06).
// --user-data-dir is also a native Chromium switch, so app.getPath('userData')
// already points at the harness profile here; rebuild the default location
// (appData/<app name>) instead of asking for it (bug found 2026-09-07).
const DEFAULT_USER_DATA = path.join(app.getPath('appData'), app.name);
if (USER_DATA_DIR) {
    app.setPath('userData', path.resolve(USER_DATA_DIR));
}

let mainWindow: BrowserWindow | null = null;
let noteOpened: (files: string[]) => void = () => {};

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
    noteOpened(files);
    const url = new URL(appUrl('/'));
    for (const file of files) {
        const entry = registerFile(file);
        url.searchParams.append('load', entry.url);
        url.searchParams.append('filename', entry.filename);
    }
    return url.toString();
};

// Window bounds persist across launches (userData/window-state.json) so the app
// comes back where the user left it instead of centered over other windows.
type WindowState = { x?: number, y?: number, width: number, height: number, maximized?: boolean };

const DEFAULT_WINDOW: WindowState = { width: 1600, height: 1000 };

const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

const loadWindowState = (): WindowState => {
    const candidates = [windowStateFile(), path.join(DEFAULT_USER_DATA, 'window-state.json')];
    for (const file of candidates) {
        try {
            const state = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Number.isFinite(state.width) && Number.isFinite(state.height) && state.width >= 400 && state.height >= 300) {
                return state;
            }
        } catch {
            // first launch or unreadable file
        }
    }
    return { ...DEFAULT_WINDOW };
};

// only restore a position that is still (mostly) on a connected display
const isOnScreen = (state: WindowState) => {
    if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) {
        return false;
    }
    return screen.getAllDisplays().some(({ workArea }) => {
        return state.x! + state.width > workArea.x + 60 &&
            state.x! < workArea.x + workArea.width - 60 &&
            state.y! >= workArea.y - 20 &&
            state.y! < workArea.y + workArea.height - 60;
    });
};

const saveWindowState = (win: BrowserWindow) => {
    if (win.isDestroyed()) {
        return;
    }
    const state: WindowState = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    try {
        fs.writeFileSync(windowStateFile(), JSON.stringify(state));
    } catch (error) {
        log(`[shell] window state not saved: ${(error as Error).message}`);
    }
};

const trackWindowState = (win: BrowserWindow) => {
    let timer: NodeJS.Timeout | null = null;
    const scheduleSave = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            saveWindowState(win);
        }, 500);
    };
    win.on('resize', scheduleSave);
    win.on('move', scheduleSave);
    win.on('maximize', scheduleSave);
    win.on('unmaximize', scheduleSave);
    win.on('close', () => {
        if (timer) clearTimeout(timer);
        saveWindowState(win);
    });
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
    const state = loadWindowState();
    const restorePosition = isOnScreen(state);

    const win = new BrowserWindow({
        width: state.width,
        height: state.height,
        ...(restorePosition ? { x: state.x, y: state.y } : {}),
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

    win.once('ready-to-show', () => {
        if (state.maximized) {
            win.maximize();
        }
        win.show();
    });
    trackWindowState(win);

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

    // upstream (src/editor.ts) returns a message from `beforeunload` while the scene has
    // unsaved changes; a browser prompts, Electron would silently cancel the close and the
    // window's X would appear dead. Ask natively instead and proceed on confirmation.
    win.webContents.on('will-prevent-unload', (event) => {
        const choice = dialog.showMessageBoxSync(win, {
            type: 'question',
            buttons: ['Quit', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            title: 'SuperSplat Desktop',
            message: 'You have unsaved changes.',
            detail: 'Quit anyway? Unsaved changes will be lost.'
        });
        if (choice === 0) {
            event.preventDefault();
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
        platform: process.platform,
        userData: app.getPath('userData')
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
            noteOpened(files);
            mainWindow.webContents.send('ss:open-files', files.map(registerFile));
        }
    });

    app.whenReady().then(() => {
        installAppProtocol(DIST_DIR);
        installDevicePolicies(session.defaultSession, appUrl(''));
        registerIpc();
        noteOpened = installFileIpc({
            storageFile: path.join(app.getPath('userData'), 'file-dirs.json'),
            getWindow: () => mainWindow,
            log,
            testDir: TEST_DIR,
            testOpen: TEST_OPEN
        }).noteOpened;
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
