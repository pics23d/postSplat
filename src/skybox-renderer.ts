import {
    CULLFACE_NONE,
    PROJECTION_PERSPECTIVE,
    SEMANTIC_POSITION,
    BlendState,
    DepthState,
    Layer,
    Mat4,
    QuadRender,
    Shader,
    ShaderUtils
} from 'playcanvas';

import { Element, ElementType } from './element';
import { vertexShader, fragmentShader } from './shaders/skybox-shader';
import { Skybox } from './skybox';

// [custom] Draws the scene's Skybox element (see skybox.ts) as the first thing
// in the world layer. A permanent scene element rather than part of the Skybox
// itself so its preRenderLayer hook is registered before the grid's and the
// sky always lands underneath it; the Skybox element only supplies the texture.

const TONEMAP_INDEX: Record<string, number> = {
    linear: 0,
    neutral: 1,
    aces: 2,
    aces2: 3,
    filmic: 4,
    hejl: 5
};

class SkyboxRenderer extends Element {
    shader: Shader;
    quadRender: QuadRender;

    constructor() {
        super(ElementType.other);
    }

    add() {
        const { scene } = this;
        const device = scene.app.graphicsDevice;

        this.shader = ShaderUtils.createShader(device, {
            uniqueName: 'skybox-equirect',
            attributes: {
                vertex_position: SEMANTIC_POSITION
            },
            vertexWGSL: vertexShader,
            fragmentWGSL: fragmentShader
        });

        this.quadRender = new QuadRender(this.shader);

        const projection = new Mat4();
        const viewProjection = new Mat4();
        const invViewProjection = new Mat4();
        const textureSize = [0, 0];

        scene.camera.camera.on('preRenderLayer', (layer: Layer, transparent: boolean) => {
            if (layer !== scene.worldLayer || transparent) {
                return;
            }

            const { camera } = scene;
            if (!camera.renderSkybox) {
                return;
            }

            const skybox = scene.skybox;
            if (!skybox?.visible) {
                return;
            }

            const cam = camera.camera;

            // the sky is a dome, so an orthographic view still looks through a
            // perspective frustum of the same fov rather than at one colour
            if (cam.projection === PROJECTION_PERSPECTIVE) {
                projection.copy(cam.projectionMatrix);
            } else {
                projection.setPerspective(cam.fov, cam.aspectRatio, cam.nearClip, cam.farClip, cam.horizontalFov);
            }
            viewProjection.mul2(projection, cam.viewMatrix);
            invViewProjection.copy(viewProjection).invert();

            textureSize[0] = skybox.texture.width;
            textureSize[1] = skybox.texture.height;

            const { scope } = device;
            scope.resolve('sky_invViewProjection').setValue(invViewProjection.data);
            scope.resolve('sky_tonemap').setValue(TONEMAP_INDEX[camera.tonemapping] ?? 0);
            scope.resolve('sky_exposure').setValue(scene.app.scene.exposure);
            scope.resolve('sky_textureSize').setValue(textureSize);
            scope.resolve('sky_texture').setValue(skybox.texture);

            device.setBlendState(BlendState.NOBLEND);
            device.setCullMode(CULLFACE_NONE);
            device.setDepthState(DepthState.NODEPTH);
            device.setStencilState(null, null);

            this.quadRender.render();
        });
    }

    remove() {
        this.shader.destroy();
        this.quadRender.destroy();
    }
}

export { SkyboxRenderer };
export type { Skybox };
