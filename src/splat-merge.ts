import {
    ChunkData,
    ChunkLayer,
    ChunkSource,
    ChunkSourceMetadata,
    ReadRequest
} from '@playcanvas/splat-transform';

import { EditorSplatResource } from './editor-splat-resource';
import { GaussianInstances } from './gaussian-instances';
import { Scene } from './scene';
import { Splat } from './splat';
import { createExportSource } from './splat-serialize';
import { State } from './splat-state';

// [custom] Merge several layers into one new layer (user CR 2026-09-11).
//
// Layers are views over one static asset each, so layers from different files
// cannot share rows. The merge therefore runs the export pipeline in memory:
// the same streaming source Export writes (world transform, transform palette
// and colour grade baked, SH rotated, deleted rows gone, the output in PLY
// space with the highest band count of the inputs) is materialized into a
// source that owns its buffers, and a fresh asset + layer is built from it
// exactly as a loaded file would be. Row order = the given layer order, each
// layer in its own instance order. The selected / hidden flags travel with
// the rows; the merged layer starts at identity with the load rotation.

const LAYERS: ChunkLayer[] = ['position', 'geometric', 'color'];

// CPU-resident ChunkSource over per-chunk buffers (splat-transform's own
// InMemoryChunkSource is not exported at the package level). Serves both the
// chunk sweep the resource upload runs and the row gathers a document save
// or a filtered export issue.
class MemoryChunkSource implements ChunkSource {
    meta: ChunkSourceMetadata;
    private chunks: Map<ChunkLayer, ArrayBuffer[]>;

    constructor(meta: ChunkSourceMetadata, chunks: Map<ChunkLayer, ArrayBuffer[]>) {
        this.meta = meta;
        this.chunks = chunks;
    }

    read(request: ReadRequest): Promise<void> {
        const { chunkSize } = this.meta;
        for (const layer of LAYERS) {
            const target = (request as Partial<Record<ChunkLayer, ChunkData>>)[layer];
            const chunks = this.chunks.get(layer);
            if (!target || !chunks) {
                continue;
            }
            const stride = this.meta.layouts[layer].stride;
            const out = new Uint8Array(target.data);
            if ('indices' in request) {
                for (let j = 0; j < request.count; ++j) {
                    const row = request.indices[request.indexOffset + j];
                    const chunk = chunks[Math.floor(row / chunkSize)];
                    out.set(new Uint8Array(chunk, (row % chunkSize) * stride, stride), j * stride);
                }
            } else {
                out.set(new Uint8Array(chunks[request.chunkIndex]));
            }
        }
        return Promise.resolve();
    }

    close(): Promise<void> {
        this.chunks.clear();
        return Promise.resolve();
    }
}

// read every chunk of the lazy export source once into owned buffers
const materialize = async (source: ChunkSource, acquire: (layer: ChunkLayer, count: number) => ChunkData) => {
    const { meta } = source;
    const chunks = new Map<ChunkLayer, ArrayBuffer[]>(LAYERS.map((layer): [ChunkLayer, ArrayBuffer[]] => [layer, []]));
    for (let chunkIndex = 0; chunkIndex < meta.numChunks[0]; ++chunkIndex) {
        const count = Math.min(meta.chunkSize, meta.numGaussians - chunkIndex * meta.chunkSize);
        const acquired = LAYERS.map(layer => acquire(layer, count));
        try {
            await source.read({ chunkIndex, position: acquired[0], geometric: acquired[1], color: acquired[2] });
            LAYERS.forEach((layer, i) => {
                chunks.get(layer).push(acquired[i].data.slice(0, count * acquired[i].stride));
            });
        } finally {
            acquired.forEach(data => data.release());
        }
    }
    return new MemoryChunkSource(meta, chunks);
};

const mergeSplats = async (scene: Scene, splats: Splat[], name: string): Promise<Splat | null> => {
    const built = await createExportSource(splats, {});
    if (!built) {
        return null;
    }
    const { source, pool } = built;
    let memory: MemoryChunkSource;
    try {
        memory = await materialize(source, (layer, count) => pool.acquire(layer, source.meta.layouts[layer], count));
    } finally {
        await source.close();
        pool.destroy();
    }

    const device = scene.graphicsDevice;
    const resource = await EditorSplatResource.create(device, memory);
    const asset = scene.assetLoader.createGSplatAsset(resource, name);

    // the export source enumerates every live instance of each layer in
    // instance order, so the flags concatenate the same way
    const flags = new Uint8Array(resource.numRows);
    let offset = 0;
    for (const splat of splats) {
        const src = splat.instances.flags;
        const count = splat.instances.count;
        for (let i = 0; i < count; ++i) {
            flags[offset + i] = src[i] & (State.selected | State.hidden);
        }
        offset += count;
    }
    const instances = new GaussianInstances(device, resource.numRows, flags);

    return new Splat(asset, memory.meta.transform.rotation, instances);
};

export { mergeSplats };
