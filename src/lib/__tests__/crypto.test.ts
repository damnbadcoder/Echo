import { vi, describe, it, expect } from 'vitest';

vi.mock('expo-secure-store', () => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

import { sealDirectMessage, openDirectMessage, IdentityKeyPair } from '../crypto-core';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';

function createMockIdentity(): IdentityKeyPair {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const edPublic = ed25519.getPublicKey(seed);
    const xSecret = crypto.getRandomValues(new Uint8Array(32));
    const xPublic = x25519.getPublicKey(xSecret);
    return { seed, edPublic, edSecret: seed, xPublic, xSecret, publicId: 'mock' };
}

describe('Echo CryptoCore', () => {
    it('encrypts and decrypts a direct message successfully', () => {
        const alice = createMockIdentity();
        const bob = createMockIdentity();

        const originalText = 'Meet at the central square at 18:00';
        const packed = sealDirectMessage({
            sender: alice,
            recipientXPublic: bob.xPublic,
            body: originalText,
        });

        const decrypted = openDirectMessage({
            recipient: bob,
            packedPayload: packed,
        });

        expect(decrypted.body).toBe(originalText);
    });

    it('fails if message is tampered with over the air', () => {
        const alice = createMockIdentity();
        const bob = createMockIdentity();

        const packed = sealDirectMessage({
            sender: alice,
            recipientXPublic: bob.xPublic,
            body: 'Sensitive message',
        });

        // Tamper with the last byte
        packed[packed.length - 1] ^= 0x01;

        expect(() => {
            openDirectMessage({ recipient: bob, packedPayload: packed });
        }).toThrow();
    });
});
