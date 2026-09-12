import {
    ADDRESS_CLAMP_TO_EDGE,
    ADDRESS_REPEAT,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
    PIXELFORMAT_RGBA8,
    GraphicsDevice,
    Texture
} from 'playcanvas';

import { Element, ElementType } from './element';
import { Serializer } from './serializer';

// [custom] Skybox layer (user CR 2026-09-12): an equirectangular background
// image - the WebP dome the online Studio composes behind a published scene,
// previewed here so the splat can be judged against it while editing. WebP,
// JPEG and PNG import; the file's bytes are kept verbatim so a document save
// writes the original into the .ssproj. One skybox per scene; it is not a
// Splat, so no selection / edit / export / publish path ever sees it - the
// publish and export pipelines enumerate ElementType.splat only.

const SKYBOX_EXTENSIONS = ['.webp', '.jpg', '.jpeg', '.png'];

const MIME_TYPES: Record<string, string> = {
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png'
};

const extensionOf = (filename: string) => {
    const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
};

const isSkyboxImage = (filename: string) => SKYBOX_EXTENSIONS.includes(extensionOf(filename));

class Skybox extends Element {
    texture: Texture;
    // the imported file, written verbatim into the document archive
    bytes: Uint8Array;
    filename: string;
    imageWidth: number;
    imageHeight: number;

    private _name: string;
    private _visible = true;

    private constructor(texture: Texture, bytes: Uint8Array, filename: string, imageWidth: number, imageHeight: number) {
        super(ElementType.skybox);
        this.texture = texture;
        this.bytes = bytes;
        this.filename = filename;
        this.imageWidth = imageWidth;
        this.imageHeight = imageHeight;
        this._name = filename;
    }

    // decode the image and upload it as a repeat-U / clamp-V mipmapped texture.
    // Images wider than the device limit are downscaled to fit; the stored
    // bytes stay the original file.
    static async load(device: GraphicsDevice, bytes: Uint8Array, filename: string): Promise<Skybox> {
        const blob = new Blob([bytes as unknown as BlobPart], { type: MIME_TYPES[extensionOf(filename)] ?? 'application/octet-stream' });
        let bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
        const imageWidth = bitmap.width;
        const imageHeight = bitmap.height;

        const max = device.maxTextureSize;
        if (bitmap.width > max || bitmap.height > max) {
            const scale = Math.min(max / bitmap.width, max / bitmap.height);
            const resized = await createImageBitmap(bitmap, {
                premultiplyAlpha: 'none',
                resizeWidth: Math.max(1, Math.floor(bitmap.width * scale)),
                resizeHeight: Math.max(1, Math.floor(bitmap.height * scale)),
                resizeQuality: 'high'
            });
            bitmap.close();
            bitmap = resized;
        }

        const texture = new Texture(device, {
            name: `skybox:${filename}`,
            width: bitmap.width,
            height: bitmap.height,
            format: PIXELFORMAT_RGBA8,
            mipmaps: true,
            minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_REPEAT,
            addressV: ADDRESS_CLAMP_TO_EDGE
        });
        // the engine accepts an ImageBitmap source at runtime; its typings predate it
        texture.setSource(bitmap as unknown as HTMLImageElement);

        return new Skybox(texture, bytes, filename, imageWidth, imageHeight);
    }

    destroy() {
        super.destroy();
        this.texture.destroy();
    }

    set name(value: string) {
        if (value !== this._name) {
            this._name = value;
            this.scene?.events.fire('skybox.name', this);
        }
    }

    get name() {
        return this._name;
    }

    set visible(value: boolean) {
        if (value !== this._visible) {
            this._visible = value;
            this.scene?.events.fire('skybox.visibility', this);
        }
    }

    get visible() {
        return this._visible;
    }

    get extension() {
        return extensionOf(this.filename);
    }

    serialize(serializer: Serializer) {
        serializer.pack(this.visible);
    }

    docSerialize() {
        return {
            name: this.name,
            filename: this.filename,
            visible: this.visible
        };
    }

    docDeserialize(doc: any) {
        if (typeof doc.name === 'string') {
            this.name = doc.name;
        }
        this.visible = doc.visible ?? true;
    }
}

export { Skybox, isSkyboxImage, SKYBOX_EXTENSIONS };
