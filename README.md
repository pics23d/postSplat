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
**cleaning real photogrammetry captures**, where splat training leaves floaters, veils and pale
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

Full detail, and which parts are worth taking upstream:
**[docs/CHANGES-vs-upstream.md](docs/CHANGES-vs-upstream.md)**.

## Status

**Work in progress, used daily by one person.** No release binaries yet; build from source. There
is no support and no roadmap commitment.

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

Please report issues with **this fork** here, not to PlayCanvas.

## Licence

MIT. `LICENSE` carries PlayCanvas's original copyright notice, as MIT requires, with a second line
for the modifications in this fork.
