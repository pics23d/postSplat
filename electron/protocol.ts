// [custom] Serves the rollup `dist/` folder on a privileged custom scheme.
//
// Why a scheme and not file://: the renderer fetches `./static/locales/*.json`
// (i18next-http-backend) and resolves the WebP wasm against `document.baseURI`;
// WebGPU and WebHID additionally require a secure context. `app://editor/`
// with `standard + secure + supportFetchAPI` gives all of that without running
// a local HTTP server.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { net, protocol } from 'electron';

export const APP_SCHEME = 'app';
export const APP_HOST = 'editor';

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8'
};

/** Must run before `app.whenReady()`. */
export const registerAppScheme = () => {
    protocol.registerSchemesAsPrivileged([{
        scheme: APP_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            stream: true,
            corsEnabled: true,
            // upstream index.html unregisters legacy service workers at startup;
            // with workers disallowed that call rejects with InvalidStateError
            allowServiceWorkers: true
        }
    }]);
};

// Applied to HTML responses only. Everything the editor needs is same-origin;
// inline styles are used by PCUI, wasm needs 'wasm-unsafe-eval', video export
// and image tools use blob: URLs.
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'"
].join('; ');

export const appUrl = (pathname = '/') => `${APP_SCHEME}://${APP_HOST}${pathname}`;

// Local files handed to the renderer (command line, file association). Only
// explicitly registered paths are reachable, as app://editor/__file/<id>/<name>.
const FILE_PREFIX = '/__file/';
const registeredFiles = new Map<string, string>();

export const registerFile = (absolutePath: string) => {
    const id = String(registeredFiles.size);
    registeredFiles.set(id, path.resolve(absolutePath));
    return {
        filename: path.basename(absolutePath),
        url: appUrl(`${FILE_PREFIX}${id}/${encodeURIComponent(path.basename(absolutePath))}`)
    };
};

const resolveRequestPath = (root: string, pathname: string): string | null => {
    let rel = decodeURIComponent(pathname);

    if (rel.startsWith(FILE_PREFIX)) {
        const id = rel.slice(FILE_PREFIX.length).split('/')[0];
        return registeredFiles.get(id) ?? null;
    }

    if (rel === '' || rel === '/') {
        rel = '/index.html';
    }

    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
        return null;
    }
    return file;
};

/** Must run after `app.whenReady()`. Maps app://editor/<path> onto <distDir>/<path>. */
export const installAppProtocol = (distDir: string) => {
    const root = path.resolve(distDir);

    protocol.handle(APP_SCHEME, async (request) => {
        const url = new URL(request.url);
        if (url.host !== APP_HOST) {
            return new Response('Not found', { status: 404 });
        }

        const file = resolveRequestPath(root, url.pathname);
        if (!file) {
            return new Response('Forbidden', { status: 403 });
        }

        try {
            const stat = await fs.promises.stat(file);
            if (!stat.isFile()) {
                return new Response('Not found', { status: 404 });
            }
        } catch {
            return new Response('Not found', { status: 404 });
        }

        const type = MIME[path.extname(file).toLowerCase()];

        if (type?.startsWith('text/html')) {
            // upstream index.html carries an inline legacy service-worker cleanup
            // script; there are no service workers on the desktop, and the CSP
            // has no 'unsafe-inline' for scripts, so drop inline scripts here
            // rather than whitelisting a hash that changes with every upstream edit.
            const html = (await fs.promises.readFile(file, 'utf8'))
            .replace(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
            return new Response(html, {
                status: 200,
                headers: {
                    'Content-Type': type,
                    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
                    'Cache-Control': 'no-cache'
                }
            });
        }

        const fileResponse = await net.fetch(pathToFileURL(file).toString());
        const headers = new Headers(fileResponse.headers);
        if (type) {
            headers.set('Content-Type', type);
        }
        headers.set('Cache-Control', 'no-cache');

        return new Response(fileResponse.body, {
            status: fileResponse.status,
            headers
        });
    });
};
