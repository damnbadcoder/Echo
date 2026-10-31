export type BleMeshModuleEvents = {
  onRawData: (params: { peerId?: string; base64Bytes?: string; payload?: string }) => void;
  onPeerDiscovered: (params: { peerId: string; rssi?: number; tag?: string }) => void;
  onPeerConnected: (params: { peerId: string }) => void;
  onDeviceDisconnected: (params: { peerId: string }) => void;
};

export type ChangeEventPayload = {
  value: string;
};
