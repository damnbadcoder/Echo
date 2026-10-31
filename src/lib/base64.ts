const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const lookup = new Uint8Array(256);
for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
}

export function bytesToBase64(bytes: Uint8Array): string {
    let result = '';
    const len = bytes.length;
    for (let i = 0; i < len; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < len ? bytes[i + 1] : 0;
        const b2 = i + 2 < len ? bytes[i + 2] : 0;
        result += chars[b0 >> 2];
        result += chars[((b0 & 3) << 4) | (b1 >> 4)];
        result += i + 1 < len ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
        result += i + 2 < len ? chars[b2 & 63] : '=';
    }
    return result;
}

export function base64ToBytes(b64: string): Uint8Array {
    const clean = b64.replace(/[\r\n\s]/g, '').replace(/=+$/, '');
    const len = clean.length;
    const bytesLen = Math.floor((len * 3) / 4);
    const bytes = new Uint8Array(bytesLen);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
        const c0 = lookup[clean.charCodeAt(i)];
        const c1 = lookup[clean.charCodeAt(i + 1)];
        const c2 = i + 2 < len ? lookup[clean.charCodeAt(i + 2)] : 0;
        const c3 = i + 3 < len ? lookup[clean.charCodeAt(i + 3)] : 0;
        bytes[p++] = (c0 << 2) | (c1 >> 4);
        if (p < bytesLen) bytes[p++] = ((c1 & 15) << 4) | (c2 >> 2);
        if (p < bytesLen) bytes[p++] = ((c2 & 3) << 6) | c3;
    }
    return bytes;
}
