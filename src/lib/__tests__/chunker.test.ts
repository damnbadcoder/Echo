
import { describe, it, expect } from 'vitest';
import { sliceIntoChunks, ChunkReassembler, CHUNK_HEADER_SIZE } from '../chunker';

describe('Echo Chunker & Reassembler', () => {
    it('handles a single chunk message immediately without delay', () => {
        const reassembler = new ChunkReassembler();
        const data = new TextEncoder().encode('Short walkie-talkie message');

        const chunks = sliceIntoChunks(data, 180);
        expect(chunks.length).toBe(1);

        const result = reassembler.ingestChunk('peer1', chunks[0]);
        expect(result).not.toBeNull();
        expect(new TextDecoder().decode(result!)).toBe('Short walkie-talkie message');
    });

    it('slices and reassembles a multi-chunk payload in order', () => {
        const reassembler = new ChunkReassembler();
        // 500 bytes sliced into 100-byte MTU chunks (92 bytes data per chunk)
        const original = new Uint8Array(500);
        for (let i = 0; i < original.length; i++) original[i] = i & 0xff;

        const chunks = sliceIntoChunks(original, 100);
        expect(chunks.length).toBe(Math.ceil(500 / (100 - CHUNK_HEADER_SIZE)));

        let assembled: Uint8Array | null = null;
        for (const chunk of chunks) {
            assembled = reassembler.ingestChunk('peerA', chunk);
        }

        expect(assembled).not.toBeNull();
        expect(assembled!.length).toBe(500);
        expect(assembled).toEqual(original);
    });

    it('reassembles chunks that arrive out of order (radio jitter)', () => {
        const reassembler = new ChunkReassembler();
        const original = new TextEncoder().encode(
            'Echo off-grid packet test string with multiple out-of-order chunks!');

        const chunks = sliceIntoChunks(original, 24); // Force many small chunks
        expect(chunks.length).toBeGreaterThan(2);

        // Shuffle chunks into reverse order
        const reversed = [...chunks].reverse();

        let assembled: Uint8Array | null = null;
        for (const chunk of reversed) {
            assembled = reassembler.ingestChunk('peerB', chunk);
        }

        expect(assembled).not.toBeNull();
        expect(new TextDecoder().decode(assembled!)).toBe(
            'Echo off-grid packet test string with multiple out-of-order chunks!');
    });

    it('sweeps and purges abandoned assemblies after timeout', () => {
        const reassembler = new ChunkReassembler();
        const original = new Uint8Array(500);
        const chunks = sliceIntoChunks(original, 100);

        // Send only chunk 0 (peer walks away mid-transfer)
        reassembler.ingestChunk('peerC', chunks[0]);

        // Force sweep with 0ms timeout
        reassembler.sweepExpired(0);

        // Send chunk 1 - should not assemble with the purged chunk 0
        const result = reassembler.ingestChunk('peerC', chunks[1]);
        expect(result).toBeNull();
    });
});
