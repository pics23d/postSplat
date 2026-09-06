import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { FileDirs } from '../../electron/file-dirs';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-file-dirs-'));

describe('FileDirs', () => {
    it('save and export default to the last opened file\'s directory until they have their own', () => {
        const root = scratch();
        const captures = path.join(root, 'captures');
        const exports = path.join(root, 'exports');
        fs.mkdirSync(captures);
        fs.mkdirSync(exports);
        const dirs = new FileDirs(path.join(root, 'state', 'file-dirs.json'));

        assert.equal(dirs.defaultDir('save'), undefined);
        assert.equal(dirs.defaultDir('export'), undefined);

        dirs.noteOpened(path.join(captures, 'scan.ply'));
        assert.equal(dirs.defaultDir('import'), captures);
        assert.equal(dirs.defaultDir('save'), captures);
        assert.equal(dirs.defaultDir('export'), captures);

        dirs.noteSaved('export', path.join(exports, 'scan.sog'));
        assert.equal(dirs.defaultDir('export'), exports);
        assert.equal(dirs.defaultDir('save'), captures, 'save keeps following the import directory');

        dirs.noteSaved('save', path.join(root, 'scene.ssproj'));
        assert.equal(dirs.defaultDir('save'), root);
        assert.equal(dirs.defaultDir('export'), exports);
    });

    it('persists across instances and skips directories that vanished', () => {
        const root = scratch();
        const gone = path.join(root, 'gone');
        fs.mkdirSync(gone);
        const file = path.join(root, 'file-dirs.json');

        const first = new FileDirs(file);
        first.noteOpened(path.join(root, 'a.ply'));
        first.noteSaved('export', path.join(gone, 'a.sog'));

        const second = new FileDirs(file);
        assert.equal(second.defaultDir('export'), gone);
        assert.equal(second.isKnown(path.join(gone, 'a.sog')), true);
        assert.equal(second.isKnown(path.join(root, 'never.ply')), false);

        fs.rmSync(gone, { recursive: true });
        assert.equal(second.defaultDir('export'), root, 'a vanished export directory falls back to the import one');
    });

    it('starts clean on a corrupt state file', () => {
        const root = scratch();
        const file = path.join(root, 'file-dirs.json');
        fs.writeFileSync(file, '{not json');
        const dirs = new FileDirs(file);
        assert.equal(dirs.defaultDir('save'), undefined);
        dirs.noteOpened(path.join(root, 'a.ply'));
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).import, root);
    });
});
