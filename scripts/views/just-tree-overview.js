// [custom] The reference view of _input/just-tree.ply (user-set 2026-09-06):
// sky patches between the foliage seen from the front-left, slightly below
// the crown. Apply to a running instance with
//   node scripts/cdp-eval.mjs --port 9223 --await --file scripts/views/just-tree-overview.js
// Absolute pose (position, focal point) so it does not depend on the scene
// radius; orbit azimuth 315.2°, elevation 3.7°, fov 85.
await (async () => {
    const c = window.scene.camera;
    const V = c.focalPoint.constructor;
    window.scene.events.fire('camera.setFov', 85);
    c.setPose(new V(-8.039, 4.352, 9.186), new V(1.372, 5.209, -0.289), 0);
    await new Promise(r => setTimeout(r, 500));
    return { position: [c.position.x, c.position.y, c.position.z], target: [c.focalPoint.x, c.focalPoint.y, c.focalPoint.z], fov: c.fov };
})()
