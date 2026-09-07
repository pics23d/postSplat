await (async () => {
    /* [custom] The reference view of _input/just-tree.ply (user-set 2026-09-07):
       the whole tree fills the frame from the front-left with the big sky patch
       behind the crown (replaces the 2026-09-06 pose, which sat further back).
       Apply to a running instance with
         node scripts/cdp-eval.mjs --port 9223 --await --file scripts/views/just-tree-overview.js
       Absolute pose (position, focal point) so it does not depend on the scene
       radius; fov 90, focal distance 1.48 (a fly-mode pose: the focal point sits
       just in front of the camera, so orbit gestures pivot close to the eye).
       No line comments in this file: the --file wrapper joins it onto one line. */
    const c = window.scene.camera;
    const V = c.focalPoint.constructor;
    window.scene.events.fire('camera.setFov', 90);
    c.setPose(new V(-7.794, 5.355, 7.710), new V(-6.738, 5.276, 6.676), 0);
    await new Promise(r => setTimeout(r, 500));
    return { position: [c.position.x, c.position.y, c.position.z], target: [c.focalPoint.x, c.focalPoint.y, c.focalPoint.z], fov: c.fov };
})()
