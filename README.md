# postSplat

> **This is not the official SuperSplat.** It is a personal Windows desktop fork of
> [SuperSplat](https://github.com/playcanvas/supersplat) by PlayCanvas Ltd, not affiliated with or
> endorsed by PlayCanvas. For the official, maintained editor use
> **[superspl.at/editor](https://superspl.at/editor)** — it runs in the browser with nothing to
> install.
>
> Upstream base: **`v3.1.2`** · MIT, same as upstream.

postSplat is an Electron build of the SuperSplat editor for Windows, with editing tools aimed
at one job:
**cleaning and editing gaussian splatting (3dgs) 3d-reconstructions**, where splat training leaves floaters, veils and pale
artefacts between thin structures.

## Why it exists

The browser editor is excellent, but this workflow wanted things a web deployment reasonably would
not do: a 3Dconnexion SpaceMouse over WebHID, native Save/Export dialogs that remember the last
directory, command-line and drag-and-drop file opening, and a headless test harness driving the
real app over the Chrome DevTools Protocol.

Once that shell existed, the selection tools grew to suit the cleanup job.

## What is different

Motivation first — the job it makes easier, then the feature:

- **Removing sky artefacts between foliage** → magic-wand eyedropper that samples the *rendered
  image* rather than the frontmost splat
- **Finding training floaters without two histogram drags** → Floater Selection tool (size ×
  opacity, live preview)
- **Spotting thin splats that hide on the wrong axis** → "Scale Largest" histogram axis
- **Knowing what a volume will catch before committing** → live sphere / box selection preview
- **Judging a capture against a real sky** → equirectangular skybox layer
- **Getting clutter out of the viewport while cleaning** → Hide replaces Lock
- **Combining layers after a Separate or Duplicate** → Merge Splats
- **Not selecting through the whole depth of a dense capture** → depth selection gains a far plane
  alongside upstream's per-pixel pick
- **Reading the colour axes** → colour ramp and reference markers under the histogram
- **Screen space while inspecting** → F1 cycles panels and toolbars

**[docs/OVERVIEW.md](docs/OVERVIEW.md)** walks through all of it in the order the work actually
happens, with the reasoning and the honest limits of each tool.
**[docs/CHANGES-vs-upstream.md](docs/CHANGES-vs-upstream.md)** is the engineering triage: which
changes are portable back to upstream and what each would cost.

## Download

Grab the latest build from **[Releases](https://github.com/pics23d/postSplat/releases)**:

| file | what it is |
|---|---|
| `postSplat-<version>-win-x64.zip` | unpack anywhere and run `postSplat.exe` — nothing installed, nothing written to the registry, delete the folder to remove it |
| `postSplat-<version>-portable.exe` | the same app as a single self-extracting executable |
| `postSplat Setup <version>.exe` | a normal installer with a Start-menu entry |

The zip is the easiest way to try it. Two things to expect on first run:

- **Windows SmartScreen will warn you.** The binaries are unsigned (a code-signing certificate is
  a recurring cost this project does not carry). Choose *More info → Run anyway*, or don't run it
  — that is a reasonable call for an unsigned binary from a stranger.
- **A WebGPU-capable GPU is required.** The upstream 3.x engine is WebGPU-only. Without it the app
  says so on startup rather than failing mysteriously.

Tested on NVIDIA. If it misbehaves on AMD or Intel, that is useful to hear — the custom shaders
are the likely culprit and they have only been exercised on one vendor.

## Status

**Work in progress, used daily by one person.** There is no support and no roadmap commitment.

## Build

Requires [Node.js](https://nodejs.org/) 22 or later and a **WebGPU-capable GPU** (the upstream 3.x
engine is WebGPU-only; on a machine without it the app shows a "requires WebGPU" message rather
than starting).

```sh
npm ci
npm run desktop:build     # renderer bundle + main process
npm run desktop:start     # launch
npm run desktop:pack      # NSIS installer + portable build in release/
```

Checks:

```sh
npm run lint
npm run lint:locales      # all 9 locale files must carry the same keys
npm test
```

The browser build still works exactly as upstream's: `npm run develop`, then
<http://localhost:3000>.

## Credit

SuperSplat is the work of **PlayCanvas Ltd** and its contributors. Everything good about the
underlying editor is theirs; the changes here are a narrow fork for one workflow.

| [SuperSplat Editor](https://superspl.at/editor) | [User Guide](https://developer.playcanvas.com/user-manual/gaussian-splatting/editing/supersplat/) | [Blog](https://blog.playcanvas.com) | [Forum](https://forum.playcanvas.com) |

<a href="https://github.com/playcanvas/supersplat/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=playcanvas/supersplat" />
</a>

Please report issues with **this fork** at [https://github.com/pics23d/postSplat/issues](https://github.com/pics23d/postSplat/issues), not to PlayCanvas.

## Licence

MIT. `LICENSE` carries PlayCanvas's original copyright notice, as MIT requires, with a second line
for the modifications in this fork.
