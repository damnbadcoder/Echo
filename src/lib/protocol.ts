export const MAGIC_BYTE_0 = 0x50;
export const MAGIC_BYTE_1 = 0x43;
export const PROTOCOL_VERSION = 0x01;
export const HEADER_SIZE_BYTES = 34;

export const DEFAULT_TTL_SECONDS = 21600;
export const MAX_ALLOWED_HOPS = 6;
export const TIME_BUCKET_MS = 60000;

export const BUCKET_SIZES = [256, 512, 1024, 2048, 4096, 8192, 16384, 30000];

export enum EnvelopeType {
    Sealed = 1,
    Inventory = 2,
    Request = 3,
}

export interface EnvelopeHeader {
    version: number;
    type: EnvelopeType;
    envelopeId: Uint8Array;
    timestamp : number;
    ttlSeconds: number;
    hopCount: number;
    maxHops: number;
    payloadLength: number;
}

export interface UnpackedEnvelope {
    header: EnvelopeHeader;
    payload: Uint8Array;
}

export function padToBucket(payload: Uint8Array): Uint8Array {
    const len = payload.length;
    const targetSize = BUCKET_SIZES.find(b => b >= len) ?? len;
    if (targetSize === len) return payload;
    const padded = new Uint8Array(targetSize);
    padded.set(payload, 0);

    const paddingBytes = crypto.getRandomValues(new Uint8Array(targetSize - len));
    padded.set(paddingBytes, len);
    return padded;
}

export function packEnvelope(params: {
    type: EnvelopeType;
    payload: Uint8Array;
    ttlSeconds?: number;
    maxHops?: number;
    hopCount?: number;
    envelopeId?: Uint8Array;
    timestamp?: number;
}) : Uint8Array {
    const {
        type,
        payload,
        ttlSeconds = DEFAULT_TTL_SECONDS,
        maxHops = MAX_ALLOWED_HOPS,
        hopCount = 0,
        envelopeId = crypto.getRandomValues(new Uint8Array(16)),
        timestamp = Date.now(),
    } = params;

    if (payload.length > 30000) {
        throw new Error('Payload too large');
    }
    const paddedPayload = padToBucket(params.payload);
    const coarsenedTime = Math.floor(timestamp / TIME_BUCKET_MS) * TIME_BUCKET_MS;
    const out = new Uint8Array(HEADER_SIZE_BYTES + paddedPayload.length);
    out[0] = MAGIC_BYTE_0;
    out[1] = MAGIC_BYTE_1;
    out[2] = PROTOCOL_VERSION;
    out[3] = params.type;
    out.set(envelopeId.subarray(0, 16), 4);
    const timeBig = BigInt(coarsenedTime);
    out[20] = Number((timeBig >> 40n) & 0xffn);
    out[21] = Number((timeBig >> 32n) & 0xffn);
    out[22] = Number((timeBig >> 24n) & 0xffn);
    out[23] = Number((timeBig >> 16n) & 0xffn);
    out[24] = Number((timeBig >> 8n) & 0xffn);
    out[25] = Number(timeBig & 0xffn);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint32(26, ttlSeconds, false);
    out[30] = hopCount;
    out[31] = Math.min(maxHops, MAX_ALLOWED_HOPS);
    view.setUint16(32, payload.length, false);
    out.set(paddedPayload, HEADER_SIZE_BYTES);
    return out;
}

export function unpackEnvelope(rawBytes: Uint8Array) : UnpackedEnvelope {
    if (rawBytes.length < HEADER_SIZE_BYTES) {
        throw new Error('Payload too large');
    }

    if (rawBytes[0] !== MAGIC_BYTE_0 || rawBytes[1] !== MAGIC_BYTE_1) {
        throw new Error('Invalid magic bytes: not an Echo envelope');
    }

    if (rawBytes[2] !== PROTOCOL_VERSION) {
        throw new Error(`Unsupported protocol version: ${rawBytes[2]}`);
    }

    const type = rawBytes[3] as EnvelopeType;
    const envelopeId = new Uint8Array(rawBytes.subarray(4, 20));

    const timeBig =
        (BigInt(rawBytes[20]) << 40n) |
        (BigInt(rawBytes[21]) << 32n) |
        (BigInt(rawBytes[22]) << 24n) |
        (BigInt(rawBytes[23]) << 16n) |
        (BigInt(rawBytes[24]) << 8n) |
        BigInt(rawBytes[25]);
    const timestamp = Number(timeBig);

    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const ttlSeconds = view.getUint32(26, false);
    const hopCount = rawBytes[30];
    const maxHops = Math.min(rawBytes[31], MAX_ALLOWED_HOPS);
    const payloadLength = view.getUint16(32, false);

    if (rawBytes.length < HEADER_SIZE_BYTES + payloadLength) {
        throw new Error('Envelope truncated: actual byte length smaller than declared payload');
    }

    const payload = new Uint8Array(
        rawBytes.subarray(HEADER_SIZE_BYTES, HEADER_SIZE_BYTES + payloadLength)
    );
    return {
        header: {
            version: PROTOCOL_VERSION,
            type,
            envelopeId,
            timestamp,
            ttlSeconds,
            hopCount,
            maxHops,
            payloadLength,
        },
        payload,
    };
}

