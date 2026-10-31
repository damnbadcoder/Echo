import {describe, it, expect} from 'vitest';
import {
    packEnvelope,
    unpackEnvelope,
    EnvelopeType,
    HEADER_SIZE_BYTES,
    MAX_ALLOWED_HOPS,
} from "../protocol";

describe('Echo Wire Protocol', () => {
    it('correctly serializes and deserializes a Sealed envelope with bucket padding', () => {
        const rawData = new TextEncoder().encode('Encrypted ciphertext blob goes here');

        const packed = packEnvelope({
            type: EnvelopeType.Sealed,
            payload: rawData,
            ttlSeconds: 3600,
            maxHops: 4,
        });

        expect(packed.length).toBe(HEADER_SIZE_BYTES + 256);

        const unpacked = unpackEnvelope(packed);

        expect(unpacked.header.type).toBe(EnvelopeType.Sealed);
        expect(unpacked.header.ttlSeconds).toBe(3600);
        expect(unpacked.header.maxHops).toBe(4);
        expect(unpacked.header.hopCount).toBe(0);
        expect(unpacked.header.payloadLength).toBe(rawData.length);
        expect(new TextDecoder().decode(unpacked.payload)).toBe('Encrypted ciphertext blob goes here');
    });

    it('clamps maxHops to 6 to prevent packet cycling attacks', () => {
        const rawData = new Uint8Array([1, 2, 3]);
        const packed = packEnvelope({
            type: EnvelopeType.Sealed,
            payload: rawData,
            maxHops: 99, // Malicious attempt to set 99 hops
        });

        const unpacked = unpackEnvelope(packed);
        expect(unpacked.header.maxHops).toBe(MAX_ALLOWED_HOPS);
    });

    it('rejects packets with invalid magic bytes', () => {
        const rawData = new Uint8Array([1, 2, 3]);
        const packed = packEnvelope({
            type: EnvelopeType.Sealed,
            payload: rawData,
        });

        packed[0] = 0x00; // Corrupt magic byte

        expect(() => unpackEnvelope(packed)).toThrow('Invalid magic bytes');
    });
});