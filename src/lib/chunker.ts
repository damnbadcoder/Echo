export const CHUNK_VERSION = 0x01;
export const CHUNK_HEADER_SIZE = 8;
export const DEFAULT_MAX_CHUNK_SIZE = 180;
export const MAX_CONCURRENT_ASSEMBLIES_PER_PEER = 4;
export const MAX_ASSEMBLY_BYTES = 32768;
export const ASSEMBLY_TIMEOUT_MS = 30000;

export enum FrameType {
    DATA = 0,
    HELLO = 1,
}

export interface ChunkHeader {
    version: number;
    type: FrameType;
    messageId: number;
    chunkIndex: number;
    chunkCount: number;
}

interface OngoingAssembly {
    totalChunks: number;
    receivedChunks: Map<number, Uint8Array>;
    totalBytes: number;
    lastUpdated: number;
}

export interface ParsedChunk {
    header: ChunkHeader;
    payload: Uint8Array;
}

let globalMessageCounter = Math.floor(Math.random() * 65535);

export function sliceIntoChunks(
    payload: Uint8Array,
    maxChunkSize: number = DEFAULT_MAX_CHUNK_SIZE,
    type: FrameType = FrameType.DATA
) : Uint8Array[] {
    if (maxChunkSize <= CHUNK_HEADER_SIZE) {
        throw new Error('maxChunkSize must be greater than CHUNK_HEADER_SIZE');
    }
    const maxPayloadPerChunk = maxChunkSize - CHUNK_HEADER_SIZE;
    const chunkCount = Math.ceil(payload.length / maxPayloadPerChunk);
    globalMessageCounter = (globalMessageCounter + 1) & 0xFFFF;
    const messageId = globalMessageCounter;
    const chunks: Uint8Array[] = [];
    for (let idx = 0; idx < chunkCount; idx++) {
        const start = idx * maxPayloadPerChunk;
        const end = Math.min(start + maxPayloadPerChunk, payload.length);
        const slice = payload.subarray(start, end);
        const chunk = new Uint8Array(CHUNK_HEADER_SIZE + slice.length);
        chunk[0] = CHUNK_VERSION;
        chunk[1] = type;
        const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        view.setUint16(2, messageId, false);
        view.setUint16(4, idx, false);
        view.setUint16(6, chunkCount, false);
        chunk.set(slice, CHUNK_HEADER_SIZE);
        chunks.push(chunk);
    }
    return chunks;
}

export function parseChunk(chunkBytes: Uint8Array): ParsedChunk {
    if (chunkBytes.length < CHUNK_HEADER_SIZE) {
        throw new Error("maxChunkSize must be greater than CHUNK_HEADER_SIZE");
    }
    const version = chunkBytes[0];
    const type = chunkBytes[1] as FrameType;
    const view = new DataView(chunkBytes.buffer, chunkBytes.byteOffset, chunkBytes.byteLength);
    const messageId = view.getUint16(2, false);
    const chunkIndex = view.getUint16(4, false);
    const chunkCount = view.getUint16(6, false);

    if (chunkCount === 0 || chunkIndex >= chunkCount) {
        throw new Error('Invalid chunk indices');
    }
    const payload = chunkBytes.subarray(CHUNK_HEADER_SIZE);
    return { header: {version, type, messageId, chunkIndex, chunkCount }, payload};
}

export class ChunkReassembler {
    private assemblies = new Map<string, Map<number, OngoingAssembly>>();
    ingestChunk(peerId: string, rawBytes: Uint8Array) : Uint8Array | null {
        const {header, payload} = parseChunk(rawBytes);
        if (header.version !== CHUNK_VERSION) {
            return null;
        }
        if (header.chunkCount === 1) {
            return payload;
        }

        let peerAssemblies = this.assemblies.get(peerId);
        if (!peerAssemblies) {
            peerAssemblies = new Map();
            this.assemblies.set(peerId, peerAssemblies);
        }

        let assembly = peerAssemblies.get(header.messageId);
        if (!assembly) {
            if (peerAssemblies.size >= MAX_CONCURRENT_ASSEMBLIES_PER_PEER) {
                this.evictOldest(peerAssemblies);
            }
            assembly = {
                totalChunks: header.chunkCount,
                receivedChunks: new Map(),
                totalBytes: 0,
                lastUpdated: Date.now(),
            };
            peerAssemblies.set(header.messageId, assembly);
        }

        if (!assembly.receivedChunks.has(header.chunkIndex)) {
            assembly.receivedChunks.set(header.chunkIndex, payload);
            assembly.totalBytes += payload.length;
            assembly.lastUpdated = Date.now();

            if (assembly.totalBytes > MAX_ASSEMBLY_BYTES) {
                peerAssemblies.delete(header.messageId);
                return null;
            }
        }

        if (assembly.receivedChunks.size === assembly.totalChunks) {
            peerAssemblies.delete(header.messageId);

            const completeBuffer = new Uint8Array(assembly.totalBytes);
            let offset = 0;
            for (let i = 0; i < assembly.totalChunks; i++) {
                const slice = assembly.receivedChunks.get(i);
                if (!slice) return null;
                completeBuffer.set(slice, offset);
                offset += slice.length;
            }
            return completeBuffer;
        }
        return null;
    }

    sweepExpired(timeOutMs: number = ASSEMBLY_TIMEOUT_MS) {
        const now = Date.now();
        for (const [peerId, assemblies] of this.assemblies.entries()) {
            for (const [messageId, assembly] of assemblies.entries()) {
                if (now - assembly.lastUpdated > timeOutMs) {
                    assemblies.delete(messageId);
                }
            }
            if (assemblies.size === 0) {
                this.assemblies.delete(peerId);
            }
        }
    }

    private evictOldest(peerMap: Map<number, OngoingAssembly>): void {
        let oldestMsgId: number | null = null;
        let oldestTime = Infinity;

        for (const [msgId, assembly] of peerMap.entries()) {
            if (assembly.lastUpdated < oldestTime) {
                oldestTime = assembly.lastUpdated;
                oldestMsgId = msgId;
            }
        }
        if (oldestMsgId !== null) {
            peerMap.delete(oldestMsgId);
        }
    }

    clearPeer(peerId: string) {
        this.assemblies.delete(peerId);
    }
}