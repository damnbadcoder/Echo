import { registerWebModule, NativeModule } from 'expo';

import { BleMeshModuleEvents } from './BleMesh.types';

// BleMeshModule is not available on the web platform.
class BleMeshModule extends NativeModule<BleMeshModuleEvents> {}

export default registerWebModule(BleMeshModule, 'BleMeshModule');
