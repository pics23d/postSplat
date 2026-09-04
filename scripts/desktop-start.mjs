// [custom] Launch the Electron shell with a clean environment.
//
// Terminals spawned by the VS Code extension host inherit ELECTRON_RUN_AS_NODE=1,
// which makes `electron .` run as a plain Node process and exit silently.
// This launcher strips that variable and forwards all arguments.
//
// usage: node scripts/desktop-start.mjs [--enable-logging] [electron args...]

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['.', ...process.argv.slice(2)], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    windowsHide: false
});

child.on('exit', code => process.exit(code ?? 0));
