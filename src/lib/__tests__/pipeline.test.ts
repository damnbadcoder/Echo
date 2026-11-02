import { vi, describe, it, expect } from 'vitest';

vi.mock('expo-secure-store', () => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

import { sealDirectMessage, openDirectMessage, IdentityKeyPair } from '../crypto-core';
import { packEnvelope, unpackEnvelope, EnvelopeType } from '../protocol';
import { sliceIntoChunks, ChunkReassembler } from '../chunker';
import { TagManager } from '../tag-manager';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';

function createMockIdentity(): IdentityKeyPair {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const edPublic = ed25519.getPublicKey(seed);
    const xSecret = crypto.getRandomValues(new Uint8Array(32));
    const xPublic = x25519.getPublicKey(xSecret);
    return { seed, edPublic, edSecret: seed, xPublic, xSecret, publicId: 'mock' };
}

describe('Echo Full Data-to-Byte Pipeline (End-to-End)', () => {
    it('seals, frames, slices, reassembles, un-frames, and decrypts successfully',
        () => {
            const alice = createMockIdentity();
            const bob = createMockIdentity();
            const originalText = 'Protest update: Meet at the southern monument at 19:30';

            // 1. Crypto: Alice seals message for Bob
            const sealedCiphertext = sealDirectMessage({
                sender: alice,
                recipientXPublic: bob.xPublic,
                body: originalText,
            });

            // 2. Wire Protocol: Alice packs into 34-byte envelope with bucket padding
            const envelope = packEnvelope({
                type: EnvelopeType.Sealed,
                payload: sealedCiphertext,
                ttlSeconds: 21600,
            });

            // 3. Radio Chunking: Sliced into small 100-byte BLE chunks
            const chunks = sliceIntoChunks(envelope, 100);
            expect(chunks.length).toBeGreaterThan(1);

            // 4. Radio Transit Simulation: Chunks arrive at Bob out-of-order overBluetooth
            const reassembler = new ChunkReassembler();
            const shuffledChunks = [...chunks].reverse();

            let reassembledEnvelope: Uint8Array | null = null;
            for (const chunk of shuffledChunks) {
                reassembledEnvelope = reassembler.ingestChunk('peer-alice', chunk);
            }

            expect(reassembledEnvelope).not.toBeNull();
            expect(reassembledEnvelope).toEqual(envelope);

            // 5. Wire Protocol: Bob un-frames envelope
            const unpacked = unpackEnvelope(reassembledEnvelope!);
            expect(unpacked.header.type).toBe(EnvelopeType.Sealed);

            // 6. Crypto: Bob decrypts payload and verifies Alice's signature
            const decrypted = openDirectMessage({
                recipient: bob,
                packedPayload: unpacked.payload,
            });

            expect(decrypted.body).toBe(originalText);
        });

    it('verifies TagManager tie-breaker correctly resolves duplicate links', () => {
        const tagMgrA = new TagManager(false);
        const tagMgrB = new TagManager(false);

        const tagA = tagMgrA.getCurrentTag();
        const tagB = tagMgrB.getCurrentTag();

        const aPreserves = tagMgrA.shouldPreserveOutboundLink(tagB);
        const bPreserves = tagMgrB.shouldPreserveOutboundLink(tagA);

        // Exactly one phone must preserve its outbound link, the other must drop it
        expect(aPreserves).not.toBe(bPreserves);
    });
});
