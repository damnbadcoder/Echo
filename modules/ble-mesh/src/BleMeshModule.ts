import { NativeModule, requireNativeModule } from 'expo';

import { BleMeshModuleEvents } from './BleMesh.types';

declare class BleMeshModule extends NativeModule<BleMeshModuleEvents> {
  startRadio(): void;
  stopRadio(): void;
  writeRaw(peerId: string, base64Bytes: string): void;
}

export default requireNativeModule<BleMeshModule>('BleMesh');
