if (typeof globalThis.crypto === 'undefined') {
    (globalThis as any).crypto = {};
}
if (!globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues = function <T extends ArrayBufferView | null>(array: T): T {
        if (!array) return array;
        const uint8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < uint8.length; i++) {
            const r = (Math.random() * 0x100000000) ^ (Date.now() & 0xffffffff);
            uint8[i] = (r >> ((i % 4) * 8)) & 0xff;
        }
        return array;
    };
}
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {ed25519, x25519} from "@noble/curves/ed25519.js";
import {sha256} from "@noble/hashes/sha2.js";
import {hkdf} from "@noble/hashes/hkdf.js";
import {xchacha20poly1305} from "@noble/ciphers/chacha.js";
import {bytesToHex, hexToBytes} from "@noble/hashes/utils.js";
import {bytesToBase64, base64ToBytes} from "./base64";

const SEED_STORAGE_KEY = 'echo_identity_seed_v1';
const HKDF_INFO_IDENTITY = new TextEncoder().encode('echo/v1/x25519');
const HKDF_INFO_DM = new TextEncoder().encode('echo/v1/dm');

export interface IdentityKeyPair {
    seed: Uint8Array;
    edPublic: Uint8Array;
    edSecret: Uint8Array;
    xPublic: Uint8Array;
    xSecret: Uint8Array;
    publicId: string;
}

export interface DecryptedDirectMessage {
    senderPublicId: string;
    senderEdPublic: Uint8Array;
    body: string;
}

export async function getOrCreateIdentity() : Promise<IdentityKeyPair> {
    let seed: Uint8Array;

    try {
        const seedHex= await SecureStore.getItemAsync(SEED_STORAGE_KEY);
        if (seedHex) {
            seed = hexToBytes(seedHex);
        } else {
            seed = crypto.getRandomValues(new Uint8Array(32));
            const options = Platform.OS === 'ios' ? {keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY} : undefined;
            await SecureStore.setItemAsync(SEED_STORAGE_KEY, bytesToHex(seed), options);
        }
    } catch (error) {
        console.warn('Secure store unavailable, generating ephemeral identity for this session only.', error);
        seed = crypto.getRandomValues(new Uint8Array(32));
    }

    const edPublic = ed25519.getPublicKey(seed);
    const edSecret = seed;

    const xSecret = hkdf(sha256, seed, new Uint8Array(0), HKDF_INFO_IDENTITY, 32);
    const xPublic = x25519.getPublicKey(xSecret);

    const combined = new Uint8Array(64);
    combined.set(edPublic, 0);
    combined.set(xPublic, 32);
    const publicId = bytesToBase64(combined);

    return {seed, edPublic, edSecret, xPublic, xSecret, publicId};
}

export function parsePublicId(publicId: string) : { edPublic: Uint8Array; xPublic: Uint8Array } {
    const buf = base64ToBytes(publicId);
    if (buf.length !== 64) {
        throw new Error('Invalid public Id');
    }
    return {
        edPublic: new Uint8Array(buf.subarray(0, 32)),
        xPublic: new Uint8Array(buf.subarray(32, 64))
    };
}

export function sealDirectMessage(params: {
    sender: IdentityKeyPair;
    recipientXPublic: Uint8Array;
    body: string;
}): Uint8Array {
    const { sender, recipientXPublic, body } = params;

    const ephSecret = crypto.getRandomValues(new Uint8Array(32));
    const ephPublic = x25519.getPublicKey(ephSecret);

    const shared = x25519.getSharedSecret(ephSecret, recipientXPublic);
    const salt = new Uint8Array(64);
    salt.set(ephPublic, 0);
    salt.set(recipientXPublic, 32);
    const aesKey = hkdf(sha256, shared, salt, HKDF_INFO_DM, 32);

    const bodyBytes = new TextEncoder().encode(body);
    const sigPayload = new Uint8Array(64 + bodyBytes.length);
    sigPayload.set(ephPublic, 0);
    sigPayload.set(recipientXPublic, 32);
    sigPayload.set(bodyBytes, 64);
    const signature = ed25519.sign(sigPayload, sender.edSecret);

    const innerPlainText = new Uint8Array(96 + bodyBytes.length);
    innerPlainText.set(sender.edPublic, 0);
    innerPlainText.set(signature, 32);
    innerPlainText.set(bodyBytes, 96);

    const nonce = crypto.getRandomValues(new Uint8Array(24));
    const cipher = xchacha20poly1305(aesKey, nonce);
    const ciphertext = cipher.encrypt(innerPlainText);

    const packed = new Uint8Array(56 + ciphertext.length);
    packed.set(ephPublic, 0);
    packed.set(nonce, 32);
    packed.set(ciphertext, 56);

    return packed;
}

export function openDirectMessage(params: {
    recipient: IdentityKeyPair;
    packedPayload: Uint8Array;
}): DecryptedDirectMessage {
    const { recipient, packedPayload } = params;
    if (packedPayload.length < 168) {
        throw new Error('Invalid packed payload length');
    }
    const ephPublic = packedPayload.subarray(0, 32);
    const nonce = packedPayload.subarray(32, 56);
    const ciphertext = packedPayload.subarray(56);
    const shared = x25519.getSharedSecret(recipient.xSecret, ephPublic);
    const salt = new Uint8Array(64);
    salt.set(ephPublic, 0);
    salt.set(recipient.xPublic, 32);
    const aesKey = hkdf(sha256, shared, salt, HKDF_INFO_DM, 32);

    const cipher = xchacha20poly1305(aesKey, nonce);
    const innerPlaintext = cipher.decrypt(ciphertext);

    const senderEdPublic = innerPlaintext.subarray(0, 32);
    const signature = innerPlaintext.subarray(32, 96);
    const bodyBytes = innerPlaintext.subarray(96);
    const sigPayload = new Uint8Array(64 + bodyBytes.length);
    sigPayload.set(ephPublic, 0);
    sigPayload.set(recipient.xPublic, 32);
    sigPayload.set(bodyBytes, 64);

    const isValid = ed25519.verify(signature, sigPayload, senderEdPublic);
    if (!isValid) {
        throw new Error('Invalid signature');
    }

    const body = new TextDecoder().decode(bodyBytes);
    return {
        senderPublicId: bytesToHex(senderEdPublic),
        senderEdPublic,
        body,
    };
}
export async function zeroizeIdentity() : Promise<void> {
    await SecureStore.deleteItemAsync(SEED_STORAGE_KEY);
}