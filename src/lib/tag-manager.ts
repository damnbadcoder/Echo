export const TAG_LENGTH_BYTES = 4;
export const DEFAULT_ROTATION_MS = 15 * 60 * 1000;

export class TagManager {
    private currentTag: Uint8Array;
    private rotationTimer: ReturnType<typeof setInterval> | null = null;
    private onTagRotatedCallbacks: Array<(newTag: Uint8Array) => void> = [];

    constructor(autoStartRotation = true) {
        this.currentTag = this.generateRandomTag();
        if (autoStartRotation) {
            this.startRotation();
        }
    }

    generateRandomTag() : Uint8Array {
        return crypto.getRandomValues(new Uint8Array(TAG_LENGTH_BYTES));
    }

    getCurrentTag() : Uint8Array {
        return this.currentTag;
    }

    getCurrentTagHex() : string {
        return Array.from(this.currentTag).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    onTagRotated(callback: (newTag: Uint8Array) => void): () => void {
        this.onTagRotatedCallbacks.push(callback);
        return () => {
            this.onTagRotatedCallbacks = this.onTagRotatedCallbacks.filter((cb) => cb !== callback);
        };
    }

    startRotation(intervalMs = DEFAULT_ROTATION_MS) : void {
        this.stopRotation();
        this.rotationTimer = setInterval(() => {
            this.rotateTag();
        }, intervalMs);
    }

    stopRotation() : void {
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = null;
        }
    }

    rotateTag(): Uint8Array {
        this.currentTag = this.generateRandomTag();
        for (const callback of this.onTagRotatedCallbacks)  {
            callback(this.currentTag);
        }
        return this.currentTag;
    }

    shouldPreserveOutboundLink(remoteTag: Uint8Array): boolean {
        for (let i = 0; i < Math.min(this.currentTag.length, remoteTag.length); i++) {
            if (this.currentTag[i] < remoteTag[i]) {
                return true;
            }
            if (this.currentTag[i] > remoteTag[i]) {
                return false;
            }
        }
        return false;
    }
}