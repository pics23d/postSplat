import { Color, Mat4, Quat, Texture, Vec3 } from 'playcanvas';

import { createGradeTerms, gradeTerms, type GradeParams } from './color-grade';
import { EditHistory } from './edit-history';
import { selectedRanges, SelectAllOp, SelectNoneOp, SelectInvertOp, SelectOp, HideSelectedOp, HideUnselectedOp, unhideAllOps, RemoveInstancesOp, RestoreMissingInstancesOp, MultiOp, AddSplatOp, SetLocalFrameOp, SplatsColorOp } from './edit-ops';
import { Element, ElementType } from './element';
import { Events } from './events';
import type { GridPlane } from './infinite-grid';
import { Scene } from './scene';
import { Splat } from './splat';
import { oklabDistance, quantizeColors, rgbToOklab } from './tools/color-quantize'; // [custom]

// register for editor and scene events
const registerEditorEvents = (events: Events, editHistory: EditHistory, scene: Scene) => {
    const vec = new Vec3();
    const vec2 = new Vec3();

    // get the list of selected splats (currently limited to just a single one)
    const selectedSplats = () => {
        const selected = events.invoke('selection') as Splat;
        return selected?.visible ? [selected] : [];
    };

    let lastExportCursor = 0;

    // add unsaved changes warning message.
    window.addEventListener('beforeunload', (e) => {
        if (!events.invoke('scene.dirty')) {
            // if the undo cursor matches last export, then we have no unsaved changes
            return undefined;
        }

        const msg = 'You have unsaved changes. Are you sure you want to leave?';
        e.returnValue = msg;
        return msg;
    });

    events.function('targetSize', () => {
        return scene.targetSize;
    });

    events.on('scene.clear', () => {
        scene.clear();
        editHistory.clear();
        lastExportCursor = 0;
    });

    // When a splat is destroyed, drop the edit operations that reference it: they
    // can never be replayed. Deliberately keyed on destruction rather than on
    // removal from the scene - undoing an AddSplatOp (duplicate / separate) also
    // removes the layer, and pruning there would delete the very op redo needs.
    events.on('scene.elementDestroyed', (element: Element) => {
        if (element.type === ElementType.splat) {
            editHistory.removeForSplat(element as Splat);
        }
    });

    events.function('scene.dirty', () => {
        return editHistory.cursor !== lastExportCursor;
    });

    events.on('doc.saved', () => {
        lastExportCursor = editHistory.cursor;
    });

    // force render on some events

    [
        'view.centerSize', 'view.outlineSelection', 'view.gaussians', 'view.centers', 'view.rings',
        'view.ringSize', 'view.editView',
        'view.selectionColor', 'view.selectionCenters', 'view.selectionRings',
        'view.splatsColorBlend', 'view.splatsSelectionBlend',
        'view.centersColorBlend', 'view.centersSelectionBlend',
        'view.ringsColorBlend', 'view.ringsSelectionBlend',
        'view.bands', 'view.minPixelSize', 'view.stochastic', 'view.perfOverlay', 'camera.bound', 'camera.boundDimensions', 'camera.showPoses',
        'camera.showInfo', 'selection.changed', 'tool.coordSpace', 'colorPanel.pendingChanged'
    ].forEach((eventName) => {
        events.on(eventName, () => {
            scene.forceRender = true;
        });
    });

    // grid.visible

    const setGridVisible = (visible: boolean) => {
        if (visible !== scene.grid.visible) {
            scene.grid.visible = visible;
            events.fire('grid.visible', visible);
        }
    };

    events.function('grid.visible', () => {
        return scene.grid.visible;
    });

    events.on('grid.setVisible', (visible: boolean) => {
        setGridVisible(visible);
    });

    events.on('grid.toggleVisible', () => {
        setGridVisible(!scene.grid.visible);
    });

    setGridVisible(scene.config.show.grid);

    // grid.planes: the set of planes drawn, in xz, xy, yz order

    const planeOrder: GridPlane[] = ['xz', 'xy', 'yz'];

    const setGridPlanes = (planes: GridPlane[]) => {
        const next = planeOrder.filter(plane => planes.includes(plane));
        if (next.join() !== scene.grid.planes.join()) {
            scene.grid.planes = next;
            events.fire('grid.planes', next.slice());
        }
    };

    events.function('grid.planes', () => {
        return scene.grid.planes.slice();
    });

    events.on('grid.setPlanes', (planes: GridPlane[]) => {
        setGridPlanes(planes);
    });

    events.on('grid.togglePlane', (plane: GridPlane) => {
        const planes = scene.grid.planes;
        setGridPlanes(planes.includes(plane) ? planes.filter(p => p !== plane) : [...planes, plane]);
    });

    // camera.fovDolly

    let fovDolly = false;

    const setFovDolly = (value: boolean) => {
        if (value !== fovDolly) {
            fovDolly = value;
            events.fire('camera.fovDolly', fovDolly);
        }
    };

    events.function('camera.fovDolly', () => {
        return fovDolly;
    });

    events.on('camera.setFovDolly', (value: boolean) => {
        setFovDolly(value);
    });

    // camera.fov

    const setCameraFov = (fov: number) => {
        const { camera } = scene;
        if (fov !== camera.fov) {
            const oldFovFactor = camera.fovFactor;
            camera.fov = fov;

            // by default a fov change acts like a lens zoom: scale distance so
            // the camera's world-space offset from the focal point (distance *
            // sceneRadius / fovFactor) is unchanged. with auto-dolly enabled
            // the camera moves instead, preserving the subject's framing.
            if (!fovDolly) {
                const { controls } = scene.config;
                const k = camera.fovFactor / oldFovFactor;
                const t = camera.distanceTween;
                for (const s of [t.value, t.source, t.target]) {
                    s.distance = Math.max(controls.minZoom, Math.min(controls.maxZoom, s.distance * k));
                }
            }

            events.fire('camera.fov', camera.fov);
        }
    };

    events.function('camera.fov', () => {
        return scene.camera.fov;
    });

    events.on('camera.setFov', (fov: number) => {
        setCameraFov(fov);
    });

    // camera.tonemapping

    events.function('camera.tonemapping', () => {
        return scene.camera.tonemapping;
    });

    events.on('camera.setTonemapping', (value: string) => {
        scene.camera.tonemapping = value;
    });

    // camera.bound

    let bound = scene.config.show.bound;

    const setBoundVisible = (visible: boolean) => {
        if (visible !== bound) {
            bound = visible;
            events.fire('camera.bound', bound);
        }
    };

    events.function('camera.bound', () => {
        return bound;
    });

    events.on('camera.setBound', (value: boolean) => {
        setBoundVisible(value);
    });

    events.on('camera.toggleBound', () => {
        setBoundVisible(!events.invoke('camera.bound'));
    });

    // camera.boundDimensions

    let boundDimensions = scene.config.show.boundDimensions;

    const setBoundDimensionsVisible = (visible: boolean) => {
        if (visible !== boundDimensions) {
            boundDimensions = visible;
            events.fire('camera.boundDimensions', boundDimensions);
        }
    };

    events.function('camera.boundDimensions', () => {
        return boundDimensions;
    });

    events.on('camera.setBoundDimensions', (value: boolean) => {
        setBoundDimensionsVisible(value);
    });

    events.on('camera.toggleBoundDimensions', () => {
        setBoundDimensionsVisible(!events.invoke('camera.boundDimensions'));
    });

    // camera.showPoses

    let showPoses = scene.config.show.cameraPoses;

    const setShowPoses = (visible: boolean) => {
        if (visible !== showPoses) {
            showPoses = visible;
            events.fire('camera.showPoses', showPoses);
        }
    };

    events.function('camera.showPoses', () => {
        return showPoses;
    });

    events.on('camera.setShowPoses', (value: boolean) => {
        setShowPoses(value);
    });

    events.on('camera.toggleShowPoses', () => {
        setShowPoses(!events.invoke('camera.showPoses'));
    });

    // camera.showInfo

    let showInfo = scene.config.show.cameraInfo;

    const setShowInfo = (visible: boolean) => {
        if (visible !== showInfo) {
            showInfo = visible;
            events.fire('camera.showInfo', showInfo);
        }
    };

    events.function('camera.showInfo', () => {
        return showInfo;
    });

    events.on('camera.setShowInfo', (value: boolean) => {
        setShowInfo(value);
    });

    events.on('camera.toggleShowInfo', () => {
        setShowInfo(!events.invoke('camera.showInfo'));
    });

    // [custom] focus on the point under normalized screen coordinates (the
    // context menu's "Focus on Point"; same as a double-click on the viewport)
    events.on('camera.pickFocalPoint', (x: number, y: number) => {
        if (scene.camera.controlMode === 'fly') {
            events.fire('camera.setControlMode', 'orbit');
        }
        scene.camera.pickFocalPoint(x, y);
    });

    // camera.focus

    events.on('camera.focus', () => {
        events.fire('camera.setControlMode', 'orbit');

        // the active tool's focus target (e.g. orient points) takes precedence
        const toolFocus: { position: Vec3, radius: number } | null = events.invoke('tool.focus');
        if (toolFocus) {
            scene.camera.focus({
                focalPoint: toolFocus.position,
                radius: toolFocus.radius,
                speed: 1
            });
            return;
        }

        const splat = selectedSplats()[0];
        if (splat) {
            // use current bounds (caller should have awaited the operation that changed data)
            const bound = splat.numSelected > 0 ?
                splat.selectionBound :
                splat.localBound;
            vec.copy(bound.center);

            const worldTransform = splat.worldTransform;
            worldTransform.transformPoint(vec, vec);
            worldTransform.getScale(vec2);

            scene.camera.focus({
                focalPoint: vec,
                radius: bound.halfExtents.length() * vec2.x,
                speed: 1
            });
        }
    });

    // pivot.reset

    // reset the selection's local frame back to the model's own frame, or,
    // with toCenter, to the bound center (the selection bound while gaussians
    // are selected). resets orientation in both cases
    events.on('pivot.reset', (toCenter: boolean) => {
        const splat = selectedSplats()[0];
        if (!splat) {
            return;
        }

        const bound = splat.numSelected > 0 ? splat.selectionBound : splat.localBound;
        const newOrigin = toCenter ? bound.center.clone() : new Vec3();
        const newFrame = new Quat();

        if (splat.localFrameOrigin.equals(newOrigin) && splat.localFrame.equals(newFrame)) {
            return;
        }

        events.fire('edit.add', new SetLocalFrameOp({
            splat,
            oldOrigin: splat.localFrameOrigin.clone(),
            oldFrame: splat.localFrame.clone(),
            newOrigin,
            newFrame
        }));
    });

    events.on('camera.reset', () => {
        const { initialAzim, initialElev, initialZoom } = scene.config.controls;
        const x = Math.sin(initialAzim * Math.PI / 180) * Math.cos(initialElev * Math.PI / 180);
        const y = -Math.sin(initialElev * Math.PI / 180);
        const z = Math.cos(initialAzim * Math.PI / 180) * Math.cos(initialElev * Math.PI / 180);
        const zoom = initialZoom;

        scene.camera.setPose(new Vec3(x * zoom, y * zoom, z * zoom), new Vec3(0, 0, 0));
    });

    // handle camera align events
    events.on('camera.align', (axis: string) => {
        switch (axis) {
            case 'px': scene.camera.setAzimElev(90, 0); break;
            case 'py': scene.camera.setAzimElev(0, -90); break;
            case 'pz': scene.camera.setAzimElev(0, 0); break;
            case 'nx': scene.camera.setAzimElev(270, 0); break;
            case 'ny': scene.camera.setAzimElev(0, 90); break;
            case 'nz': scene.camera.setAzimElev(180, 0); break;
        }

        // switch to ortho mode
        scene.camera.ortho = true;
    });

    // returns true if the selected splat has selected gaussians
    events.function('selection.splats', () => {
        const splat = events.invoke('selection') as Splat;
        return splat?.numSelected > 0;
    });

    events.on('select.all', () => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new SelectAllOp(splat));
        });
    });

    events.on('select.none', () => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new SelectNoneOp(splat));
        });
    });

    events.on('select.invert', () => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new SelectInvertOp(splat));
        });
    });

    events.on('select.mask', (op: 'add'|'remove'|'set'|'intersect', mask: Uint8Array | Uint32Array) => {
        selectedSplats().forEach((splat) => {
            events.fire('edit.add', new SelectOp(splat, op, mask));
        });
    });

    // run the GPU intersect + the resulting SelectOp inside one queued task so the
    // gpu readback is ordered relative to other queued history ops (rapid drag +
    // undo, drag-while-camera-settling, etc).
    const runSelectIntersect = (splat: Splat, op: 'add'|'remove'|'set'|'intersect', options: any) => {
        return scene.commandQueue.enqueue(async () => {
            // the splat may have been deleted while the task was queued
            if (!splat.scene) return;
            const data = await scene.dataProcessor.intersect(options, splat);
            // SelectOp consumes `data` synchronously in its constructor
            // (IndexRanges.fromPredicate iterates immediately), so we can
            // return the buffer to the pool as soon as the op is constructed.
            events.fire('edit.add', new SelectOp(splat, op, data));
            scene.dataProcessor.releaseMask(data);
        });
    };

    // which machinery a screen-space select gesture runs on: depth on -> the
    // per-pixel id pick (frontmost wins, op-aware peeling); depth off -> the
    // centers intersect at footprint 0, otherwise the footprint pass, which
    // tests each splat's projected ellipse against the region through all depths
    const selectionMethod = (): 'pick' | 'footprint' | 'centers' => {
        // [custom] the depth toggle is a view-space far plane now (see
        // selection.effectiveDepthFar): gestures always run through all layers
        // and the plane gates them, so the per-pixel 'pick' path is unreachable
        return (events.invoke('selection.footprint') as number) > 0 ? 'footprint' : 'centers';
    };

    // [custom] far plane snapshot for a gesture: 0 = no plane. Taken before any
    // await so a toggle mid-flight can't change a finished stroke's semantics
    const depthFarSnapshot = () => events.invoke('selection.effectiveDepthFar') as number;

    type SelectRegion = { y0: number, y1: number, intervals: Uint32Array };

    // footprint is passed in rather than read here: the task runs from the
    // queue after the gesture, and toggling the footprint in between must not
    // change an already-finished stroke's semantics
    const runFootprintSelect = (splat: Splat, op: 'add'|'remove'|'set'|'intersect', region: SelectRegion, footprint: number) => {
        return scene.commandQueue.enqueue(async () => {
            if (!splat.scene) return;
            const data = await scene.projectedSplatRenderer.footprintIntersect(splat, region, footprint);
            if (data) {
                events.fire('edit.add', new SelectOp(splat, op, data));
            }
        });
    };

    // centers + depth: exactly the surface (rings) pick - the splats visible
    // in the region, rendered at full footprint with the same op filtering so
    // peeling works identically - narrowed to those whose center lies in the
    // region. The centers test reuses the through-mode intersect compute
    const runVisibleCentersSelect = (splat: Splat, op: 'add'|'remove'|'set'|'intersect', visible: Set<number>, options: any) => {
        return scene.commandQueue.enqueue(async () => {
            if (!splat.scene) return;
            const data = await scene.dataProcessor.intersect(options, splat);
            for (let i = 0; i < splat.instances.count; i++) {
                if (data[i] && !visible.has(i)) {
                    data[i] = 0;
                }
            }
            events.fire('edit.add', new SelectOp(splat, op, data));
            scene.dataProcessor.releaseMask(data);
        });
    };

    // per-row x-interval tables in render-target pixels for the footprint
    // pass: (rowCount + 1) offsets into the same buffer, then (x0, x1) pairs,
    // so every row's runs are represented exactly

    const packRegion = (py0: number, py1: number, rowRuns: number[][]): SelectRegion => {
        const rows = py1 - py0 + 1;
        const table = rows + 1;
        let total = 0;
        for (const runs of rowRuns) {
            total += runs.length;
        }
        const intervals = new Uint32Array(table + total);
        let cursor = table;
        for (let r = 0; r < rows; r++) {
            intervals[r] = cursor;
            intervals.set(rowRuns[r], cursor);
            cursor += rowRuns[r].length;
        }
        intervals[rows] = cursor;
        return { y0: py0, y1: py1, intervals };
    };

    const emptyRegion = (): SelectRegion => {
        return packRegion(0, 0, [[]]);
    };

    const rectRegion = (x0: number, y0: number, x1: number, y1: number): SelectRegion => {
        const { width, height } = scene.targetSize;
        const py0 = Math.max(0, Math.floor(y0 * height));
        const py1 = Math.min(height - 1, Math.ceil(y1 * height) - 1);
        const px0 = Math.max(0, Math.floor(x0 * width));
        const px1 = Math.min(width - 1, Math.ceil(x1 * width) - 1);
        if (py1 < py0 || px1 < px0) {
            return emptyRegion();
        }
        const rowRuns: number[][] = [];
        for (let r = py0; r <= py1; r++) {
            rowRuns.push([px0, px1]);
        }
        return packRegion(py0, py1, rowRuns);
    };

    const maskRegion = (context: CanvasRenderingContext2D, maskWidth: number, maskHeight: number): SelectRegion => {
        const { width, height } = scene.targetSize;
        const mask = context.getImageData(0, 0, maskWidth, maskHeight);
        const xScale = width / maskWidth;

        // covered runs of a mask row, scaled to render-target pixels
        const rowRuns = (maskY: number) => {
            const runs: number[] = [];
            const rowBase = maskY * maskWidth * 4;
            let start = -1;
            for (let x = 0; x <= maskWidth; x++) {
                const covered = x < maskWidth && mask.data[rowBase + x * 4 + 3] === 255;
                if (covered && start === -1) {
                    start = x;
                } else if (!covered && start !== -1) {
                    runs.push(Math.floor(start * xScale), Math.ceil(x * xScale) - 1);
                    start = -1;
                }
            }
            return runs;
        };

        // mask row bounds
        let my0 = maskHeight;
        let my1 = -1;
        for (let y = 0; y < maskHeight; y++) {
            const rowBase = y * maskWidth * 4;
            for (let x = 0; x < maskWidth; x++) {
                if (mask.data[rowBase + x * 4 + 3] === 255) {
                    my0 = Math.min(my0, y);
                    my1 = Math.max(my1, y);
                    break;
                }
            }
        }
        if (my1 < my0) {
            return emptyRegion();
        }

        const py0 = Math.max(0, Math.floor(my0 / maskHeight * height));
        const py1 = Math.min(height - 1, Math.ceil((my1 + 1) / maskHeight * height) - 1);
        const cache = new Map<number, number[]>();
        const rows: number[][] = [];
        for (let r = py0; r <= py1; r++) {
            const maskY = Math.min(maskHeight - 1, Math.floor((r + 0.5) / height * maskHeight));
            let runs = cache.get(maskY);
            if (!runs) {
                runs = rowRuns(maskY);
                cache.set(maskY, runs);
            }
            rows.push(runs);
        }
        return packRegion(py0, py1, rows);
    };

    // transform maps the unit sphere (diameter 1) to world space
    events.on('select.bySphere', async (op: 'add'|'remove'|'set'|'intersect', transform: Mat4) => {
        const depthFar = depthFarSnapshot();
        for (const splat of selectedSplats()) {
            await runSelectIntersect(splat, op, {
                sphere: { transform, footprint: events.invoke('selection.footprint') as number },
                depthFar
            });
        }
    });

    // transform maps the unit cube (side 1) to world space
    events.on('select.byBox', async (op: 'add'|'remove'|'set'|'intersect', transform: Mat4) => {
        const depthFar = depthFarSnapshot();
        for (const splat of selectedSplats()) {
            await runSelectIntersect(splat, op, {
                box: { transform, footprint: events.invoke('selection.footprint') as number },
                depthFar
            });
        }
    });

    events.function('select.rect', async (op: 'add'|'remove'|'set'|'intersect', rect: any) => {
        const method = selectionMethod();
        const footprint = events.invoke('selection.footprint') as number;
        const depthFar = depthFarSnapshot();

        for (const splat of selectedSplats()) {
            if (method === 'centers') {
                await runSelectIntersect(splat, op, {
                    rect: { x1: rect.start.x, y1: rect.start.y, x2: rect.end.x, y2: rect.end.y },
                    depthFar
                });
            } else if (method === 'footprint') {
                await runFootprintSelect(splat, op, rectRegion(rect.start.x, rect.start.y, rect.end.x, rect.end.y), footprint);
            } else {
                scene.camera.pickPrep(splat, op);
                const pick = await scene.camera.pickRect(
                    rect.start.x,
                    rect.start.y,
                    rect.end.x - rect.start.x,
                    rect.end.y - rect.start.y
                );

                if (footprint === 0) {
                    await runVisibleCentersSelect(splat, op, new Set(pick), {
                        rect: { x1: rect.start.x, y1: rect.start.y, x2: rect.end.x, y2: rect.end.y }
                    });
                } else {
                    const sortedIds = new Uint32Array(new Set(pick)).sort();
                    events.fire('edit.add', new SelectOp(splat, op, sortedIds));
                }
            }
        }
    });

    // build an operation-private mask texture from the stroke canvas: the gpu
    // upload from setSource is deferred until the queued intersect dispatches,
    // so the pixels are copied into a fresh canvas nothing else repaints, and
    // the texture is not shared with any other gesture. Callers destroy it
    // once their queued tasks have consumed it.
    const createMaskTexture = (canvas: HTMLCanvasElement) => {
        const snapshot = document.createElement('canvas');
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        snapshot.getContext('2d').drawImage(canvas, 0, 0);
        const texture = new Texture(scene.graphicsDevice);
        texture.setSource(snapshot);
        return texture;
    };

    events.function('select.byMask', async (op: 'add'|'remove'|'set'|'intersect', canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
        const method = selectionMethod();

        // snapshot everything the stroke depends on before yielding - the
        // canvas reads so later gestures repainting it can't leak into this
        // selection (or make splats within one gesture see different masks),
        // and the footprint so toggling it can't change a finished stroke
        const maskTexture = method === 'footprint' ? null : createMaskTexture(canvas);
        const region = method === 'footprint' ? maskRegion(context, canvas.width, canvas.height) : null;
        const maskPixels = method === 'pick' ? context.getImageData(0, 0, canvas.width, canvas.height) : null;
        const footprint = events.invoke('selection.footprint') as number;
        const depthFar = depthFarSnapshot();

        try {
            for (const splat of selectedSplats()) {
                if (method === 'centers') {
                    await runSelectIntersect(splat, op, {
                        mask: maskTexture,
                        depthFar
                    });
                } else if (method === 'footprint') {
                    await runFootprintSelect(splat, op, region, footprint);
                } else {
                    const mask = maskPixels;

                    // calculate mask bound so we limit pixel operations
                    let mx0 = mask.width - 1;
                    let my0 = mask.height - 1;
                    let mx1 = 0;
                    let my1 = 0;
                    for (let y = 0; y < mask.height; ++y) {
                        for (let x = 0; x < mask.width; ++x) {
                            if (mask.data[(y * mask.width + x) * 4 + 3] === 255) {
                                mx0 = Math.min(mx0, x);
                                my0 = Math.min(my0, y);
                                mx1 = Math.max(mx1, x);
                                my1 = Math.max(my1, y);
                            }
                        }
                    }

                    // Convert mask bounds to normalized coordinates
                    const nx0 = mx0 / mask.width;
                    const ny0 = my0 / mask.height;
                    const nx1 = (mx1 + 1) / mask.width;
                    const ny1 = (my1 + 1) / mask.height;
                    const nw = nx1 - nx0;
                    const nh = ny1 - ny0;

                    scene.camera.pickPrep(splat, op);
                    const pick = await scene.camera.pickRect(nx0, ny0, nw, nh);

                    // Calculate actual pixel dimensions for iteration
                    const { width, height } = scene.targetSize;

                    // Convert normalized coordinates to render target pixels
                    const px = Math.floor(nx0 * width);
                    const py = Math.floor(ny0 * height);
                    const pw = Math.max(1, Math.ceil((nx0 + nw) * width) - px);
                    const ph = Math.max(1, Math.ceil((ny0 + nh) * height) - py);

                    const selected = new Set<number>();
                    for (let y = 0; y < ph; ++y) {
                        for (let x = 0; x < pw; ++x) {
                            const mx = Math.floor((nx0 + x / width) * mask.width);
                            const my = Math.floor((ny0 + y / height) * mask.height);
                            if (mask.data[(my * mask.width + mx) * 4] === 255) {
                                selected.add(pick[y * pw + x]);
                            }
                        }
                    }

                    if (footprint === 0) {
                        await runVisibleCentersSelect(splat, op, selected, { mask: maskTexture });
                    } else {
                        const sortedIds = new Uint32Array(selected).sort();
                        events.fire('edit.add', new SelectOp(splat, op, sortedIds));
                    }
                }
            }
        } finally {
            maskTexture?.destroy();
        }
    });

    // points are stroke samples in normalized screen coordinates with radii in
    // css pixels. Each sample is depth-picked to a world position and the world
    // radius matched to the on-screen brush size, giving a capsule path the
    // compute pass tests splat centers against.
    events.function('select.bySphereBrush', async (
        op: 'add'|'remove'|'set'|'intersect',
        points: { x: number, y: number, radius: number }[],
        canvas: HTMLCanvasElement
    ) => {
        const splats = selectedSplats();

        // snapshot everything gesture-dependent now: the shared stroke canvas
        // may be repainted by another tool, the camera moved and the footprint
        // toggled before the queued work below runs
        const mask = createMaskTexture(canvas);
        const projection = scene.camera.camera.projectionMatrix.clone();
        const view = scene.camera.camera.viewMatrix.clone();
        const footprint = events.invoke('selection.footprint') as number;
        const depthFar = depthFarSnapshot();
        const pixelScale = scene.camera.worldSizePerPixel(1);
        const ortho = scene.camera.ortho;
        const pose = {
            position: scene.camera.mainCamera.getPosition().clone(),
            rotation: scene.camera.mainCamera.getRotation().clone(),
            orthoHeight: scene.camera.camera.orthoHeight,
            near: scene.camera.near,
            far: scene.camera.far
        };

        // one queued operation reserves the stroke's place in history now and
        // runs the depth picking and the intersect against the same scene
        // state; enqueueing only after the readbacks would let a queued
        // delete/undo apply in between. The intersect is inlined rather than
        // going through runSelectIntersect because nesting enqueues deadlocks.
        try {
            await scene.commandQueue.enqueue(async () => {
                // [custom] the brush lands on the surface inside the far plane
                const hits = await scene.camera.intersectMany(points, splats, pose, depthFar > 0);
                const path: number[] = [];
                let previous: { position: Vec3, radius: number } | null = null;

                for (let i = 0; i < points.length; ++i) {
                    const hit = hits[i];
                    if (!hit) {
                        previous = null;
                        continue;
                    }

                    const radius = points[i].radius * pixelScale * (ortho ? 1 : hit.depth);
                    const startsPath = !previous || previous.position.distance(hit.position) > Math.max(previous.radius, radius) * 2;
                    path.push(hit.position.x, hit.position.y, hit.position.z, startsPath ? -radius : radius);
                    previous = { position: hit.position, radius };
                }

                const pathPoints = new Float32Array(path);
                for (const splat of splats) {
                    const data = await scene.dataProcessor.intersect({
                        sphereBrush: { points: pathPoints, mask, footprint, projection, view },
                        depthFar
                    }, splat);
                    // SelectOp consumes `data` synchronously in its constructor
                    events.fire('edit.add', new SelectOp(splat, op, data));
                    scene.dataProcessor.releaseMask(data);
                }
            });
        } finally {
            mask.destroy();
        }
    });

    events.function('select.point', async (op: 'add'|'remove'|'set'|'intersect', point: { x: number, y: number }) => {
        const { width, height } = scene.targetSize;
        const method = selectionMethod();
        const footprint = events.invoke('selection.footprint') as number;
        const depthFar = depthFarSnapshot();

        for (const splat of selectedSplats()) {
            if (method === 'centers') {
                await runSelectIntersect(splat, op, {
                    rect: {
                        x1: point.x,
                        y1: point.y,
                        x2: point.x + 1 / width,
                        y2: point.y + 1 / height
                    },
                    depthFar
                });
            } else if (method === 'footprint') {
                await runFootprintSelect(splat, op, rectRegion(
                    point.x, point.y, point.x + 1 / width, point.y + 1 / height), footprint);
            } else {
                // depth-mode clicks deliberately ignore the footprint toggle
                // and pick the frontmost splat under the cursor: requiring a
                // visible center at the clicked pixel (as rect/mask gestures do
                // in centers mode) would make clicking practically never land
                scene.camera.pickPrep(splat, op);

                // Use normalized coordinates with minimal size for single pixel pick
                const pickResult = await scene.camera.pickRect(
                    point.x,
                    point.y,
                    1 / width,
                    1 / height
                );
                const pickId = pickResult[0];
                events.fire('edit.add', new SelectOp(splat, op, new Uint32Array([pickId])));
            }
        }
    });

    // [custom] Eyedropper colour selection (M4). Upstream matched one picked
    // splat against a per-channel threshold in one step; the fork splits it in
    // two so the tool can hold several samples and preview live:
    //   select.colorSample(point) -> the rendered colour ([r, g, b]) under the
    //     normalized point, or null over the void. Sampled like a 2D eyedropper
    //     from a clean render (no tints, no depth fade, splats beyond the depth
    //     plane left out), averaged over a small box: the frontmost splat under
    //     a pixel is usually a faint veil, not the colour the user means (2026-09-06,
    //     just-tree.ply: 13 of 80 picks under sky pixels were sky splats).
    //   select.colorSampleRegion(points, maxColors) -> the distinct colours
    //     along a stroke, quantised in OKLab, largest cluster first.
    //   select.colorMatch(op, refs, params) -> a SelectOp against every splat
    //     whose colour lies within params.tolerance of any reference colour
    //     under params.metric ('rgb' | 'hsv' | 'oklab'); resolves to the op once
    //     it is in the history so the caller can recognise it later (edit.top).
    const SAMPLE_RADIUS = 2;         // box half-size in render pixels
    const SAMPLE_MIN_ALPHA = 0.05;   // below this the box is the void

    type Rgb = [number, number, number];
    type NormalizedPoint = { x: number, y: number };

    // one clean render at half resolution with a box sampler over it. The
    // splat pass composites premultiplied over transparent black, so dividing
    // a box's rgb sum by its alpha sum recovers the alpha-weighted colour of
    // the contributing splats instead of a colour darkened at soft edges
    const cleanRender = async () => {
        const targetSize = scene.targetSize;
        if (!selectedSplats().length || !targetSize?.width || !targetSize?.height) {
            return null;
        }
        const width = Math.max(1, Math.round(targetSize.width / 2));
        const height = Math.max(1, Math.round(targetSize.height / 2));
        const data = await events.invoke('render.offscreen', width, height, true) as Uint8Array;
        const toPixel = (point: NormalizedPoint) => ({
            x: Math.round(Math.max(0, Math.min(1, point.x)) * (width - 1)),
            y: Math.round(Math.max(0, Math.min(1, point.y)) * (height - 1))
        });
        // un-premultiplied colour of one pixel, null in the void
        const pixel = (x: number, y: number): Rgb | null => {
            const i = (y * width + x) * 4;
            const a = data[i + 3];
            if (a < SAMPLE_MIN_ALPHA * 255) {
                return null;
            }
            return [Math.min(1, data[i] / a), Math.min(1, data[i + 1] / a), Math.min(1, data[i + 2] / a)];
        };
        const sample = (point: NormalizedPoint): Rgb | null => {
            const { x: cx, y: cy } = toPixel(point);
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let y = Math.max(0, cy - SAMPLE_RADIUS); y <= Math.min(height - 1, cy + SAMPLE_RADIUS); y++) {
                for (let x = Math.max(0, cx - SAMPLE_RADIUS); x <= Math.min(width - 1, cx + SAMPLE_RADIUS); x++) {
                    const i = (y * width + x) * 4;
                    r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]; n++;
                }
            }
            if (!n || a / n < SAMPLE_MIN_ALPHA * 255) {
                return null;
            }
            return [Math.min(1, r / a), Math.min(1, g / a), Math.min(1, b / a)];
        };
        return { data, width, height, toPixel, pixel, sample };
    };

    events.function('select.colorSample', async (point: NormalizedPoint) => {
        if (!point) {
            return null;
        }
        const render = await cleanRender();
        return render ? render.sample(point) : null;
    });

    events.function('select.colorSampleRegion', async (points: NormalizedPoint[], maxColors = 16) => {
        if (!points?.length) {
            return [];
        }
        const render = await cleanRender();
        if (!render) {
            return [];
        }
        const colors = points.map(render.sample).filter(c => c !== null);
        return quantizeColors(colors, maxColors);
    });

    // magic wand region: flood fill of the clean render from each seed, joining
    // pixels whose colour lies within tolerance (OKLab) of that seed's colour,
    // like Photoshop's contiguous wand. Returns the union mask (1 = in region)
    // and its pixel count
    // pixels below this coverage never join a flood: their un-premultiplied
    // colour is 8-bit noise, and the fringe of every splat is made of them, so
    // a flood would leak through the whole image (tree, 2026-09-06: a 0.12 click
    // grew to 98k pixels and hid 1,331 splats, most of them foliage)
    const FLOOD_MIN_ALPHA = 0.15;
    // pixels contributing to the region's colour palette must be this covered
    const FLOOD_PALETTE_MIN_ALPHA = 0.5;

    const floodRegion = (render: NonNullable<Awaited<ReturnType<typeof cleanRender>>>, seeds: NormalizedPoint[], tolerance: number) => {
        const { data, width, height, pixel, toPixel, sample } = render;
        const mask = new Uint8Array(width * height);
        const lab = new Float32Array(width * height * 3);
        const labDone = new Uint8Array(width * height);
        const labAt = (index: number, x: number, y: number): [number, number, number] | null => {
            if (!labDone[index]) {
                labDone[index] = 1;
                const c = data[index * 4 + 3] >= FLOOD_MIN_ALPHA * 255 ? pixel(x, y) : null;
                if (!c) {
                    return null;
                }
                const l = rgbToOklab(c);
                lab[index * 3] = l[0]; lab[index * 3 + 1] = l[1]; lab[index * 3 + 2] = l[2];
                labDone[index] = 2;
            }
            return labDone[index] === 2 ? [lab[index * 3], lab[index * 3 + 1], lab[index * 3 + 2]] : null;
        };
        let count = 0;
        const bbox = { x0: width, y0: height, x1: -1, y1: -1 };
        // the region's palette, from well-covered pixels only: a sky shade the
        // seed alone would miss is in here, a sky-through-leaves blend is not
        const colors: Rgb[] = [];
        const stack: number[] = [];
        for (const seed of seeds) {
            const { x: sx, y: sy } = toPixel(seed);
            const seedIndex = sy * width + sx;
            // the seed colour is the box sample, not one pixel: a click on a
            // sky-through-leaves blend would otherwise seed a colour within
            // tolerance of both sides
            const seedColor = sample(seed);
            const seedLab = seedColor && labAt(seedIndex, sx, sy) ? rgbToOklab(seedColor) : null;
            if (!seedLab || mask[seedIndex]) {
                continue;
            }
            mask[seedIndex] = 1;
            stack.push(seedIndex);
            while (stack.length) {
                const index = stack.pop();
                const x = index % width;
                const y = (index - x) / width;
                count++;
                if (x < bbox.x0) bbox.x0 = x;
                if (x > bbox.x1) bbox.x1 = x;
                if (y < bbox.y0) bbox.y0 = y;
                if (y > bbox.y1) bbox.y1 = y;
                const neighbours = [index - 1, index + 1, index - width, index + width];
                const valid = [x > 0, x < width - 1, y > 0, y < height - 1];
                for (let k = 0; k < 4; k++) {
                    const n = neighbours[k];
                    if (!valid[k] || mask[n]) {
                        continue;
                    }
                    const nl = labAt(n, n % width, (n - (n % width)) / width);
                    if (nl && Math.hypot(nl[0] - seedLab[0], nl[1] - seedLab[1], nl[2] - seedLab[2]) <= tolerance) {
                        mask[n] = 1;
                        stack.push(n);
                    }
                }
            }
        }
        // the palette comes from the region's interior (all four neighbours in
        // the region): the rim is where the patch blends into its surroundings
        // within tolerance, and those mixed pixels made a chip of their own
        // (user report 2026-09-07: a greenish chip from a click on blue sky)
        let sampled = 0;
        for (let y = bbox.y0; y <= bbox.y1; y++) {
            for (let x = bbox.x0; x <= bbox.x1; x++) {
                const index = y * width + x;
                if (!mask[index]) continue;
                const interior = x > 0 && x < width - 1 && y > 0 && y < height - 1 &&
                    mask[index - 1] && mask[index + 1] && mask[index - width] && mask[index + width];
                if (!interior) continue;
                if ((sampled++ & 7) === 0 && data[index * 4 + 3] >= FLOOD_PALETTE_MIN_ALPHA * 255) {
                    const c = pixel(x, y);
                    if (c) colors.push(c);
                }
            }
        }
        // bbox as fractions of the render, for diagnostics
        return { mask, count, colors, bbox: { x0: bbox.x0 / width, y0: bbox.y0 / height, x1: (bbox.x1 + 1) / width, y1: (bbox.y1 + 1) / height } };
    };

    // a region mask (1 = in) on a canvas the footprint pass can read
    const maskCanvas = (mask: Uint8Array, width: number, height: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        const image = context.createImageData(width, height);
        for (let i = 0; i < mask.length; i++) {
            if (mask[i]) {
                image.data[i * 4] = 255;
                image.data[i * 4 + 3] = 255;
            }
        }
        context.putImageData(image, 0, 0);
        return { canvas, context };
    };

    const COLOR_METRICS: { [key: string]: number } = { rgb: 0, hsv: 1, oklab: 2 };

    // region: strokes (normalized points) and a radius as a fraction of the
    // target width; the match is limited to splats whose centre projects within
    // that distance of a stroke (2026-09-06: the residual sky patches on the tree
    // are a few opaque whitish splats whose colours match nothing in the chips;
    // their own sampled colour at 0.16 sweeps 494 splats scene-wide but 25 near
    // the stroke)
    type ColorMatchRegion = { strokes: { x: number, y: number }[][], radius: number };

    // the strokes drawn as round-capped lines on a half-resolution mask canvas
    const regionCanvas = (region: ColorMatchRegion) => {
        const { width, height } = scene.targetSize;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width / 2));
        canvas.height = Math.max(1, Math.round(height / 2));
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = '#f60';
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = Math.max(1, 2 * region.radius * canvas.width);
        for (const stroke of region.strokes) {
            if (!stroke.length) continue;
            context.beginPath();
            context.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
            for (const p of stroke) {
                context.lineTo(p.x * canvas.width, p.y * canvas.height);
            }
            context.stroke();
        }
        return { canvas, context };
    };

    // splats whose projected ellipse touches a screen region. Always the
    // footprint test, whatever the toolbar's centres/footprint toggle says: the
    // splats that paint a patch mostly have their centres elsewhere (tree, sky
    // stroke at 12 px: centres 19 splats / 0 % of the sky, footprint 113 / 41 %;
    // user question 2026-09-06). The toggle's footprint scale is honoured when set.
    const regionSplats = (splat: Splat, region: { canvas: HTMLCanvasElement, context: CanvasRenderingContext2D }): Promise<Uint8Array | null> => {
        const toggle = events.invoke('selection.footprint') as number;
        const footprint = toggle > 0 ? toggle : 1;
        return scene.projectedSplatRenderer.footprintIntersect(splat, maskRegion(region.context, region.canvas.width, region.canvas.height), footprint);
    };

    type ColorMatchParams = { metric?: string, tolerance?: number, hsvWeights?: [number, number, number] };

    // the colour match itself, optionally ANDed with a screen region; adds one
    // SelectOp per edit target and resolves to the last one
    const runColorMatch = async (
        op: 'add' | 'remove' | 'set' | 'intersect',
        refs: number[][],
        params: ColorMatchParams,
        region: { canvas: HTMLCanvasElement, context: CanvasRenderingContext2D } | null
    ) => {
        const splats = selectedSplats();
        if (!splats.length || !refs?.length) {
            return null;
        }
        const flat = new Float32Array(refs.length * 3);
        refs.forEach((c, i) => flat.set([c[0], c[1], c[2]], i * 3));
        const matchParams = {
            metric: COLOR_METRICS[params.metric ?? 'rgb'] ?? 0,
            tolerance: Math.max(0, Number.isFinite(params.tolerance) ? params.tolerance : 0),
            hsvWeights: params.hsvWeights
        };
        // far plane: gates the match kernel (the sample pick was gated when taken)
        const depthFar = depthFarSnapshot();
        const viewMatrix = scene.camera.camera.viewMatrix.clone();

        let result: SelectOp | null = null;
        for (const splat of splats) {
            // the op is built inside the queue so it sees the selection state
            // after any undo that was queued before it (live preview)
            const selectOp = await scene.commandQueue.enqueue(async () => {
                const mask = await scene.dataProcessor.colorMatch(splat, flat, matchParams, {
                    entityMatrix: splat.entity.getWorldTransform(),
                    cameraPos: scene.camera.position,
                    viewMatrix,
                    depthFar
                });
                if (region) {
                    const inRegion = await regionSplats(splat, region);
                    if (inRegion) {
                        for (let i = 0; i < mask.length; i++) {
                            mask[i] = inRegion[i] === 255 ? mask[i] : 0;
                        }
                    }
                }
                const selectOp = new SelectOp(splat, op, mask);
                scene.dataProcessor.releaseMask(mask);
                return selectOp;
            });
            await editHistory.add(selectOp);
            result = selectOp;
        }
        return result;
    };

    // [custom] Floater selection (user CR 2026-09-08): floaters are large and
    // faint, so one kernel ANDs "largest scale axis >= minScale" with
    // "opacity <= maxOpacity" (the Scale Largest and Opacity histogram axes in
    // one gesture). Honours the depth far plane like every viewport tool.
    // select.floaterRange = the scene's range of largest scales (the size
    // slider's span), from the histogram kernel's min / max
    events.function('select.floaterRange', async () => {
        const splats = selectedSplats();
        let min = Infinity;
        let max = -Infinity;
        for (const splat of splats) {
            const histogram = await scene.commandQueue.enqueue(() => scene.dataProcessor.calcHistogram(splat, 72, {
                entityMatrix: splat.entity.getWorldTransform(),
                viewMatrix: scene.camera.camera.viewMatrix,
                cameraPos: scene.camera.position,
                logBins: false
            }));
            if (histogram.numValues > 0) {
                min = Math.min(min, histogram.min);
                max = Math.max(max, histogram.max);
            }
        }
        return Number.isFinite(min) ? { min, max } : null;
    });

    events.function('select.floaters', async (
        op: 'add' | 'remove' | 'set' | 'intersect',
        params: { minScale: number, maxOpacity: number }
    ) => {
        const splats = selectedSplats();
        if (!splats.length) {
            return null;
        }
        const depthFar = depthFarSnapshot();
        const viewMatrix = scene.camera.camera.viewMatrix.clone();
        const floaterParams = {
            minScale: Math.max(0, Number.isFinite(params.minScale) ? params.minScale : 0),
            maxOpacity: Math.min(1, Math.max(0, Number.isFinite(params.maxOpacity) ? params.maxOpacity : 1))
        };

        let result: SelectOp | null = null;
        for (const splat of splats) {
            // the op is built inside the queue so it sees the selection state
            // after any undo that was queued before it (live preview)
            const selectOp = await scene.commandQueue.enqueue(async () => {
                const mask = await scene.dataProcessor.selectFloaters(splat, floaterParams, {
                    entityMatrix: splat.entity.getWorldTransform(),
                    viewMatrix,
                    depthFar
                });
                const selectOp = new SelectOp(splat, op, mask);
                scene.dataProcessor.releaseMask(mask);
                return selectOp;
            });
            await editHistory.add(selectOp);
            result = selectOp;
        }
        return result;
    });

    events.function('select.colorMatch', (
        op: 'add' | 'remove' | 'set' | 'intersect',
        refs: number[][],
        params: ColorMatchParams & { region?: ColorMatchRegion } = {}
    ) => {
        const region = params.region?.strokes?.length ? regionCanvas(params.region) : null;
        return runColorMatch(op, refs, params, region);
    });

    // [custom] magic wand (M4, user feedback 2026-09-06: "near stroke + radius"
    // exposed the mechanism, the intent is Photoshop's wand). seeds = the
    // session's clicks and stroke points. Contiguous: flood the clean render
    // from every seed within the tolerance, take the region's colours as the
    // references and limit the match to splats whose footprint touches the
    // region. Not contiguous: the seeds' sampled colours matched everywhere.
    // Resolves to { op, refs } (op = the SelectOp now on top of the history).
    // reference colours the user dropped by clicking their chips: a reference
    // within this OKLab distance of an excluded colour is left out
    const EXCLUDE_DISTANCE = 0.05;
    const withoutExcluded = (refs: Rgb[], exclude: Rgb[] | undefined) => {
        if (!exclude?.length) {
            return refs;
        }
        return refs.filter(ref => !exclude.some(e => oklabDistance(ref, e) <= EXCLUDE_DISTANCE));
    };

    events.function('select.colorWand', async (
        op: 'add' | 'remove' | 'set' | 'intersect',
        seeds: NormalizedPoint[],
        params: ColorMatchParams & { contiguous?: boolean, exclude?: Rgb[] } = {}
    ) => {
        if (!seeds?.length) {
            return null;
        }
        const render = await cleanRender();
        if (!render) {
            return null;
        }
        const tolerance = Math.max(0, Number.isFinite(params.tolerance) ? params.tolerance : 0);
        if (params.contiguous === false) {
            // every click stays its own reference (only near-duplicates merge):
            // with the default merge distance the sky patches of the tree all
            // folded into one chip and further clicks changed nothing
            const refs = withoutExcluded(quantizeColors(seeds.map(render.sample).filter(c => c !== null), 16, 0.015), params.exclude);
            if (!refs.length) {
                return null;
            }
            const selectOp = await runColorMatch(op, refs, params, null);
            return selectOp ? { op: selectOp, refs } : null;
        }
        const flood = floodRegion(render, seeds, tolerance);
        if (!flood.count) {
            return null;
        }
        // references = the seeds plus the region's well-covered palette, minus
        // the chips the user dropped. The seeds alone miss the patch's other
        // shades (tree, 2026-09-06: one seed at 0.1 selected 24 splats and
        // cleared 3 % of the sky); the whole palette including thin blends
        // matched foliage (a 0.08 click hid 707 splats and the sky grew by 38 %).
        // Palette shades covering less than 3 % of the interior are noise
        const palette = quantizeColors(flood.colors, 16, 0.05, 0.03);
        const refs = withoutExcluded(quantizeColors([...seeds.map(render.sample).filter(c => c !== null), ...palette], 16), params.exclude);
        if (!refs.length) {
            return null;
        }
        const region = maskCanvas(flood.mask, render.width, render.height);
        const selectOp = await runColorMatch(op, refs, params, region);
        return selectOp ? { op: selectOp, refs, pixels: flood.count, bbox: flood.bbox } : null;
    });

    // [custom] the most recent applied history entry (null when none), so a
    // tool can tell whether its own preview op is still the top of the stack
    events.function('edit.top', () => {
        return editHistory.history[editHistory.cursor - 1] ?? null;
    });

    // [custom] Hide (user CR 2026-09-08): the three ops act on the active layer
    // only, like every other edit (upstream's unlock swept every layer)
    events.on('select.hide', () => {
        selectedSplats().forEach((splat) => {
            const op = new HideSelectedOp(splat);
            if (!op.ranges.empty) {
                events.fire('edit.add', op);
            }
        });
    });

    events.on('select.hideUnselected', () => {
        selectedSplats().forEach((splat) => {
            const op = new HideUnselectedOp(splat);
            if (!op.ranges.empty) {
                events.fire('edit.add', op);
            }
        });
    });

    events.on('select.unhide', () => {
        selectedSplats().forEach((splat) => {
            const ops = unhideAllOps(splat);
            if (ops.length > 0) {
                events.fire('edit.add', ops.length === 1 ? ops[0] : new MultiOp(ops));
            }
        });
    });

    events.on('select.delete', () => {
        // Don't delete gaussians when a point-placing tool is active (backspace deletes its points instead)
        if (['measure', 'orient'].includes(events.invoke('tool.active'))) {
            return;
        }
        // Don't delete gaussians while a polygon selection is in progress (backspace removes the last point instead)
        if (events.invoke('polygonSelection.removeLastPoint')) {
            return;
        }
        selectedSplats().forEach((splat) => {
            editHistory.add(new RemoveInstancesOp(splat));
        });
    });

    // Duplicate and separate both create a new layer holding the selected
    // gaussians. The new layer *shares* the source layer's static data, so this
    // copies the instance list only: no gaussians are duplicated, and there is no
    // PLY round trip to lose SH precision, drop extra columns or reorder out of
    // Morton. The asset is reference counted, so it outlives either layer.
    const performSelectionFunc = (func: 'duplicate' | 'separate') => {
        const splat = selectedSplats()[0];
        if (!splat) {
            return;
        }

        const ranges = selectedRanges(splat);
        if (ranges.count === 0) {
            return;
        }

        const copy = splat.createLayer(ranges, splat.name);

        if (func === 'separate') {
            editHistory.add(new MultiOp([
                new RemoveInstancesOp(splat),
                new AddSplatOp(scene, copy)
            ]));
        } else {
            editHistory.add(new AddSplatOp(scene, copy));
        }
    };

    // duplicate the current selection
    events.on('edit.duplicate', () => {
        performSelectionFunc('duplicate');
    });

    events.on('edit.separate', () => {
        performSelectionFunc('separate');
    });

    // bake the panel's pending grade into the selected gaussians. `params` are the
    // seven authored values; the op composes them onto whatever grade the targets
    // already carry, so applying twice is the same as applying the composition.
    events.on('edit.applyColor', (params: GradeParams) => {
        const splat = events.invoke('selection') as Splat;
        if (splat) {
            editHistory.add(new SplatsColorOp({ splat, grade: gradeTerms(params, createGradeTerms()) }));
        }
    });

    // clear the grade on the selected gaussians
    events.on('edit.resetColor', () => {
        const splat = events.invoke('selection') as Splat;
        if (splat) {
            editHistory.add(new SplatsColorOp({ splat, grade: null }));
        }
    });

    events.on('scene.reset', () => {
        selectedSplats().forEach((splat) => {
            editHistory.add(new RestoreMissingInstancesOp(splat));
        });
    });

    // display

    let showGaussians = true;
    let showCenters = false;
    let showRings = false;
    let ringSize = 4;

    events.function('view.gaussians', () => showGaussians);
    events.function('view.centers', () => showCenters);
    events.function('view.rings', () => showRings);
    events.function('view.ringSize', () => ringSize);

    events.on('view.setGaussians', (value: boolean) => {
        if (value !== showGaussians) {
            showGaussians = value;
            events.fire('view.gaussians', value);
        }
    });

    events.on('view.setCenters', (value: boolean) => {
        if (value !== showCenters) {
            showCenters = value;
            events.fire('view.centers', value);
        }
    });

    events.on('view.setRings', (value: boolean) => {
        if (value !== showRings) {
            showRings = value;
            events.fire('view.rings', value);
        }
    });

    events.on('view.setRingSize', (value: number) => {
        if (value !== ringSize) {
            ringSize = value;
            events.fire('view.ringSize', value);
        }
    });

    // per-surface colour blend weights. colorBlend mixes the base colour from
    // the gaussian's own colour (0) toward the flat unselected colour (1);
    // selectionBlend mixes a selected splat from that base toward the
    // selection colour
    const blends: [name: string, value: number][] = [
        ['splatsColorBlend', 0],
        ['splatsSelectionBlend', 1],
        ['centersColorBlend', 1],
        ['centersSelectionBlend', 1],
        ['ringsColorBlend', 0],
        ['ringsSelectionBlend', 1]
    ];
    blends.forEach(([name, initial]) => {
        let value = initial;
        const setEvent = `view.set${name[0].toUpperCase()}${name.slice(1)}`;
        events.function(`view.${name}`, () => value);
        events.on(setEvent, (next: number) => {
            if (next !== value) {
                value = next;
                events.fire(`view.${name}`, next);
            }
        });
    });

    // selection controls: depth on = the per-pixel id pick (frontmost wins),
    // depth off = through all layers; footprint scales how much of each splat's
    // projected ellipse counts, from its center point (0) to the full footprint (1)

    let selectionUseDepth = false;
    let selectionFootprint = 0;

    events.function('selection.useDepth', () => selectionUseDepth);

    events.on('selection.setUseDepth', (value: boolean) => {
        if (value !== selectionUseDepth) {
            selectionUseDepth = value;
            scene.forceRender = true; // [custom] the far-plane fade is a render state
            events.fire('selection.useDepth', value);
        }
    });

    events.on('selection.toggleUseDepth', () => {
        events.fire('selection.setUseDepth', !selectionUseDepth);
    });

    // [custom] depth selection = a far plane at a view-space distance from the
    // camera (the toggle above enables it). Splats beyond the plane render darkened
    // (colour × depthFade) and are never selected by viewport tools. depthFar 0 = unset: the plane
    // then sits at the camera's focal distance and follows the zoom until the
    // user sets a value (slider, Alt+wheel), which freezes it.
    let selectionDepthFar = 0;
    let selectionDepthFade = 0.25;

    events.function('selection.depthFar', () => selectionDepthFar);

    events.function('selection.effectiveDepthFar', () => {
        if (!selectionUseDepth) {
            return 0;
        }
        return selectionDepthFar > 0 ? selectionDepthFar : scene.camera.focalDistance;
    });

    events.on('selection.setDepthFar', (value: number) => {
        const next = Number.isFinite(value) && value > 0 ? Math.max(1e-3, value) : 0;
        if (next !== selectionDepthFar) {
            selectionDepthFar = next;
            scene.forceRender = true;
            events.fire('selection.depthFar', next);
        }
    });

    // Alt+wheel: ±5% per notch, from the effective plane so the first notch
    // moves the focal-distance default instead of jumping from 0
    events.on('selection.stepDepthFar', (notches: number) => {
        const current = events.invoke('selection.effectiveDepthFar') as number;
        if (current > 0 && notches) {
            events.fire('selection.setDepthFar', current * (1.05 ** -notches));
        }
    });

    events.function('selection.depthFade', () => selectionDepthFade);

    events.on('selection.setDepthFade', (value: number) => {
        const next = Math.min(1, Math.max(0, value));
        if (next !== selectionDepthFade) {
            selectionDepthFade = next;
            scene.forceRender = true;
            events.fire('selection.depthFade', next);
        }
    });

    // a new document starts with the plane back at the focal distance
    events.on('scene.elementRemoved', (element: Element) => {
        if (element.type === ElementType.splat && scene.getElementsByType(ElementType.splat).length === 0) {
            events.fire('selection.setDepthFar', 0);
        }
    });

    events.function('selection.footprint', () => selectionFootprint);

    events.on('selection.setFootprint', (value: number) => {
        if (value !== selectionFootprint) {
            selectionFootprint = value;
            events.fire('selection.footprint', value);
        }
    });

    events.on('selection.toggleFootprint', () => {
        events.fire('selection.setFootprint', selectionFootprint > 0 ? 0 : 1);
    });

    // camera control mode (orbit/fly)

    let controlMode: 'orbit' | 'fly' = 'orbit';

    const setControlMode = (mode: 'orbit' | 'fly') => {
        if (mode !== controlMode) {
            controlMode = mode;
            scene.camera.controlMode = mode;
            events.fire('camera.controlMode', controlMode);
        }
    };

    events.function('camera.controlMode', () => {
        return controlMode;
    });

    events.on('camera.setControlMode', (mode: 'orbit' | 'fly') => {
        setControlMode(mode);
    });

    events.on('camera.toggleControlMode', () => {
        setControlMode(controlMode === 'orbit' ? 'fly' : 'orbit');
    });

    // center size

    let centerSize = 2;

    const setCenterSize = (value: number) => {
        if (value !== centerSize) {
            centerSize = value;
            events.fire('view.centerSize', centerSize);
        }
    };

    events.function('view.centerSize', () => {
        return centerSize;
    });

    events.on('view.setCenterSize', (value: number) => {
        setCenterSize(value);
    });

    // camera fly speed

    const setFlySpeed = (value: number) => {
        if (value !== scene.camera.flySpeed) {
            scene.camera.flySpeed = value;
            events.fire('camera.flySpeed', value);
        }
    };

    events.function('camera.flySpeed', () => {
        return scene.camera.flySpeed;
    });

    events.on('camera.setFlySpeed', (value: number) => {
        setFlySpeed(value);
    });

    // selection display

    let selectionColor = false;
    let selectionCenters = true;
    let selectionRings = false;

    events.function('view.selectionColor', () => selectionColor);
    events.function('view.selectionCenters', () => selectionCenters);
    events.function('view.selectionRings', () => selectionRings);

    events.on('view.setSelectionColor', (value: boolean) => {
        if (value !== selectionColor) {
            selectionColor = value;
            events.fire('view.selectionColor', value);
        }
    });

    events.on('view.setSelectionCenters', (value: boolean) => {
        if (value !== selectionCenters) {
            selectionCenters = value;
            events.fire('view.selectionCenters', value);
        }
    });

    events.on('view.setSelectionRings', (value: boolean) => {
        if (value !== selectionRings) {
            selectionRings = value;
            events.fire('view.selectionRings', value);
        }
    });

    // per-footprint-mode view profiles: each footprint mode (centers/rings)
    // remembers its own overlay arrangement. The live view flags are the
    // active mode's profile; this holds the other mode's, applied when the
    // footprint toggle crosses the centers/rings boundary. Encoded as 0/1 in
    // [gaussians, centers, rings, selectionCenters, selectionRings] order
    const profileFlags: [get: string, set: string][] = [
        ['view.gaussians', 'view.setGaussians'],
        ['view.centers', 'view.setCenters'],
        ['view.rings', 'view.setRings'],
        ['view.selectionCenters', 'view.setSelectionCenters'],
        ['view.selectionRings', 'view.setSelectionRings']
    ];
    let inactiveProfile = [1, 0, 1, 0, 1];
    let profileMode = (events.invoke('selection.footprint') as number) > 0;

    // preference application sets the footprint, the live flags and the
    // inactive profile explicitly, so the boundary-crossing swap below must
    // stay out of its way or it shuffles the slots it is being loaded into
    let prefsSuspendDepth = 0;
    events.on('preferences.suspend', () => {
        prefsSuspendDepth++;
    });
    events.on('preferences.resume', () => {
        prefsSuspendDepth = Math.max(0, prefsSuspendDepth - 1);
    });

    events.function('view.inactiveProfile', () => inactiveProfile.slice());

    events.on('view.setInactiveProfile', (profile: number[]) => {
        inactiveProfile = profile.slice();
    });

    // the swap is a mode change, not an appearance edit: it must not switch
    // the edit view back on (see below)
    let swappingProfile = false;

    events.on('selection.footprint', (value: number) => {
        const mode = value > 0;
        if (mode !== profileMode) {
            profileMode = mode;
            if (prefsSuspendDepth > 0) {
                return;
            }
            const snapshot = profileFlags.map(([get]) => (events.invoke(get) ? 1 : 0));
            swappingProfile = true;
            profileFlags.forEach(([, set], i) => {
                events.fire(set, !!inactiveProfile[i]);
            });
            swappingProfile = false;
            inactiveProfile = snapshot;
            events.fire('view.inactiveProfile', inactiveProfile.slice());
        }
    });

    // edit view switch (tab): while off, the non-selection overlays hide
    // and gaussians render regardless of the profile, so it toggles between
    // the editing view and the raw scene. Off by default and stored as a
    // preference. Toggling one of the display overlays below switches it
    // back on so the toggle is never adjusted blind - but not preference
    // application or the footprint profile swap, which are not the user
    // toggling a display overlay
    let editView = false;

    const setEditView = (value: boolean) => {
        if (value !== editView) {
            editView = value;
            events.fire('view.editView', value);
        }
    };

    events.function('view.editView', () => editView);

    events.on('view.setEditView', setEditView);

    events.on('view.toggleEditView', () => {
        setEditView(!editView);
    });

    ['view.gaussians', 'view.centers', 'view.rings'].forEach((eventName) => {
        events.on(eventName, () => {
            if (prefsSuspendDepth === 0 && !swappingProfile) {
                setEditView(true);
            }
        });
    });

    // outline selection

    let outlineSelection = false;

    const setOutlineSelection = (value: boolean) => {
        if (value !== outlineSelection) {
            outlineSelection = value;
            events.fire('view.outlineSelection', outlineSelection);
        }
    };

    events.function('view.outlineSelection', () => {
        return outlineSelection;
    });

    events.on('view.setOutlineSelection', (value: boolean) => {
        setOutlineSelection(value);
    });

    // view spherical harmonic bands

    let viewBands = scene.config.show.shBands;

    const setViewBands = (value: number) => {
        if (value !== viewBands) {
            viewBands = value;
            events.fire('view.bands', viewBands);
        }
    };

    events.function('view.bands', () => {
        return viewBands;
    });

    events.on('view.setBands', (value: number) => {
        setViewBands(value);
    });

    // minimum projected splat size in pixels (0 disables the cull)

    let minPixelSize = 2;

    events.function('view.minPixelSize', () => {
        return minPixelSize;
    });

    events.on('view.setMinPixelSize', (value: number) => {
        if (value !== minPixelSize) {
            minPixelSize = value;
            events.fire('view.minPixelSize', minPixelSize);
        }
    });

    // experimental stochastic-transparency splat renderer (1 spp, no sort).
    // 'disabled' never uses it, 'enabled' always does, 'movement' uses it only
    // while the scene is changing - trading the sort for speed exactly when the
    // eye is least able to see the sampling noise - and 'auto' behaves like
    // 'movement' while the last sorted frame proved slow (see
    // Scene.autoEngageMs).

    let stochastic = 'auto';

    events.function('view.stochastic', () => {
        return stochastic;
    });

    events.on('view.setStochastic', (value: string) => {
        if (value !== stochastic) {
            stochastic = value;
            events.fire('view.stochastic', value);
        }
    });

    // gpu/cpu frame timing overlay

    let perfOverlay = false;

    events.function('view.perfOverlay', () => {
        return perfOverlay;
    });

    events.on('view.setPerfOverlay', (value: boolean) => {
        if (value !== perfOverlay) {
            perfOverlay = value;
            events.fire('view.perfOverlay', value);
        }
    });

    events.function('camera.getPose', () => {
        const camera = scene.camera;
        const position = camera.position;
        const focalPoint = camera.focalPoint;
        return {
            position: { x: position.x, y: position.y, z: position.z },
            target: { x: focalPoint.x, y: focalPoint.y, z: focalPoint.z },
            fov: camera.fov
        };
    });

    events.on('camera.setPose', (pose: { position: Vec3, target: Vec3, fov?: number }, speed = 1) => {
        // assign fov before setPose so distance is computed using the new fovFactor
        if (pose.fov !== undefined) {
            // pose-driven fov (timeline playback, fly-to-pose) is not a user
            // preference - suspend capture around the notify and the
            // synchronous ui echo it triggers
            events.fire('preferences.suspend');
            try {
                scene.camera.fov = pose.fov;
                events.fire('camera.fov', pose.fov);
            } finally {
                events.fire('preferences.resume');
            }
        }
        scene.camera.setPose(pose.position, pose.target, speed);
    });

    // hack: fire events to initialize UI
    events.fire('camera.fov', scene.camera.fov);
    events.fire('view.bands', viewBands);
    events.fire('camera.showInfo', showInfo);
    // needed because view.setStochastic only notifies on a change, so a stored
    // preference equal to the initial value leaves the ui showing its own default
    events.fire('view.stochastic', stochastic);

    // doc serialization
    events.function('docSerialize.view', () => {
        const packC = (c: Color) => [c.r, c.g, c.b, c.a];
        return {
            bgColor: packC(events.invoke('bgClr')),
            selectedColor: packC(events.invoke('selectedClr')),
            unselectedColor: packC(events.invoke('unselectedClr')),
            lockedColor: packC(events.invoke('lockedClr')),
            shBands: events.invoke('view.bands'),
            centersSize: events.invoke('view.centerSize'),
            outlineSelection: events.invoke('view.outlineSelection'),
            showGrid: events.invoke('grid.visible'),
            gridPlanes: events.invoke('grid.planes'),
            showBound: events.invoke('camera.bound'),
            showBoundDimensions: events.invoke('camera.boundDimensions'),
            showCameraPoses: events.invoke('camera.showPoses'),
            showCameraInfo: events.invoke('camera.showInfo'),
            flySpeed: events.invoke('camera.flySpeed'),
            fovDolly: events.invoke('camera.fovDolly')
        };
    });

    events.function('docDeserialize.view', (docView: any) => {
        events.fire('setBgClr', new Color(docView.bgColor));
        events.fire('setSelectedClr', new Color(docView.selectedColor));
        events.fire('setUnselectedClr', new Color(docView.unselectedColor));
        events.fire('setLockedClr', new Color(docView.lockedColor));
        events.fire('view.setBands', docView.shBands);
        events.fire('view.setCenterSize', docView.centersSize);
        events.fire('view.setOutlineSelection', docView.outlineSelection);
        events.fire('grid.setVisible', docView.showGrid);
        // documents before the per-plane toggles stored a single gridPlane
        events.fire('grid.setPlanes', docView.gridPlanes ?? [docView.gridPlane ?? 'xz']);
        events.fire('camera.setBound', docView.showBound);
        events.fire('camera.setBoundDimensions', docView.showBoundDimensions ?? false);
        events.fire('camera.setShowPoses', docView.showCameraPoses ?? false);
        events.fire('camera.setShowInfo', docView.showCameraInfo ?? false);
        events.fire('camera.setFlySpeed', docView.flySpeed);
        events.fire('camera.setFovDolly', docView.fovDolly ?? false);
    });
};

export { registerEditorEvents };
