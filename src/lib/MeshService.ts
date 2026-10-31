// src/lib/MeshService.ts

import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Platform } from 'react-native';
import { base64ToBytes, bytesToBase64 } from './base64';
import {
    getOrCreateIdentity,
    IdentityKeyPair,
    openDirectMessage,
    sealDirectMessage,
} from './crypto-core';
import { EnvelopeDispatcher, ITransport } from './dispatcher';
import { EnvelopeType, packEnvelope, unpackEnvelope } from './protocol';
import { insertMessage, updateMessageStatus, MessageRecord, getDisplayName } from './store';
// CHANGED: Import the chunker utilities your teammate wrote
import { sliceIntoChunks, ChunkReassembler } from './chunker';

export type RadioStatus = 'scanning' | 'connecting' | 'connected' | 'off';

export interface DiscoveredPeer {
  peerId: string;
  tag: string;
  status: 'In Range' | 'Direct Peer';
  rssi?: number;
  lastSeen: number;
}

let BleMeshModule: any = null;
try {
  if (Platform.OS !== 'web') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BleMeshModule = require('../../modules/ble-mesh').default;
  }
} catch {
  console.warn('BleMesh active module not found, running in mock mode.');
}

const GLOBAL_ROOM_SEED = new TextEncoder().encode(
  'chitchatchit:channel:global_mesh_room:v1'
);
const GLOBAL_ROOM_X_SECRET = sha256(GLOBAL_ROOM_SEED);
const GLOBAL_ROOM_X_PUBLIC = x25519.getPublicKey(GLOBAL_ROOM_X_SECRET);

class MasterMeshService {
  private identity: IdentityKeyPair | null = null;
  private dispatcher: EnvelopeDispatcher | null = null;
  private onMessageListeners: Array<() => void> = [];
  private radioStatus: RadioStatus = 'scanning';
  private discoveredPeers: Map<string, DiscoveredPeer> = new Map();
  private isInitialized: boolean = false;
  
  // CHANGED: Instantiate the chunk reassembler to hold partial messages
  private reassembler: ChunkReassembler = new ChunkReassembler();

  async initialize(): Promise<void> {
    if (this.isInitialized && this.identity) {
      return;
    }

    console.log('[MeshService] Initializing...');
    try {
      this.identity = await getOrCreateIdentity();
      console.log('[MeshService] Identity loaded. Public ID:', this.identity.publicId);
    } catch (err) {
      console.error('[MeshService] Error loading identity:', err);
    }
    
    const transportBridge: ITransport = {
      send: (bytes: Uint8Array) => {
        // Slice the envelope into safe BLE-sized chunks
        const chunks = sliceIntoChunks(bytes);
        
        if (BleMeshModule?.writeRaw) {
          // Stagger chunk dispatches by 25ms so Android BLE hardware buffer does not drop consecutive writes
          chunks.forEach((chunk, index) => {
            const b64 = bytesToBase64(chunk);
            if (index === 0) {
              BleMeshModule.writeRaw('broadcast', b64);
            } else {
              setTimeout(() => {
                BleMeshModule.writeRaw('broadcast', b64);
              }, index * 25);
            }
          });
        } else {
          console.log('[MeshService] (Radio Mock) Transmitted', chunks.length, 'chunks');
        }
      },
      on: (_event: 'payload', callback: (data: Uint8Array) => void) => {
        if (BleMeshModule?.addListener) {
          BleMeshModule.addListener(
            'onRawData',
            (evt: { peerId?: string; base64Bytes?: string; payload?: string }) => {
              const b64 = evt.base64Bytes || evt.payload;
              if (!b64) return;
              if (evt.peerId) {
                this.recordPeerSeen(evt.peerId, 'Direct Peer');
              }
              
              const rawChunk = base64ToBytes(b64);
              
              // CHANGED: Feed the incoming chunk into the reassembler
              const completeEnvelope = this.reassembler.ingestChunk(evt.peerId || 'unknown', rawChunk);
              
              // Only pass to the dispatcher if the chunk completed the full envelope
              if (completeEnvelope) {
                callback(completeEnvelope);
              }
            }
          );
        }
      },
    };

    this.dispatcher = new EnvelopeDispatcher(transportBridge, (rawEnvelope) => {
      this.handleIncomingEnvelope(rawEnvelope);
    });

    this.attachDiscoveryListeners();
    this.startNativeRadio();

    this.isInitialized = true;
    this.notifyListeners();
    
    // Periodically clean up orphaned chunks from phones that walked out of range
    setInterval(() => {
      this.reassembler.sweepExpired();
    }, 30000);
  }

  private startNativeRadio(): void {
    if (BleMeshModule?.startRadio) {
      try {
        this.radioStatus = 'scanning';
        BleMeshModule.startRadio();
      } catch (err) {
        console.warn('[MeshService] Failed to start radio:', err);
        this.radioStatus = 'off';
      }
    } else {
      this.radioStatus = 'scanning';
    }
    this.notifyListeners();
  }

  private attachDiscoveryListeners(): void {
    if (!BleMeshModule?.addListener) return;
    try {
      BleMeshModule.addListener(
        'onPeerDiscovered',
        (evt: { peerId?: string; id?: string; rssi?: number; tag?: string }) => {
          const id = evt.peerId || evt.id;
          if (id) {
            this.recordPeerSeen(id, 'In Range', evt.rssi, evt.tag);
          }
        }
      );

      BleMeshModule.addListener(
        'onPeerConnected',
        (evt: { peerId?: string; id?: string }) => {
          const id = evt.peerId || evt.id;
          if (id) {
            this.recordPeerSeen(id, 'Direct Peer');
          }
          this.radioStatus = 'connected';
          this.notifyListeners();
        }
      );

      BleMeshModule.addListener(
        'onPeerDisconnected',
        (evt: { peerId?: string; id?: string }) => {
          const id = evt.peerId || evt.id;
          if (id) {
            this.discoveredPeers.delete(id);
            if (/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(id)) {
              if (this.discoveredPeers.size <= 1) {
                this.discoveredPeers.clear();
              }
            }
          }
          this.radioStatus =
            this.discoveredPeers.size > 0 ? 'connected' : 'scanning';
          this.notifyListeners();
        }
      );
    } catch {
    }
  }

  private recordPeerSeen(
    peerId: string,
    status: 'In Range' | 'Direct Peer',
    rssi?: number,
    customTag?: string
  ): void {
    const isMacAddress = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(peerId);

    if (isMacAddress) {
      const hasRealPeer = Array.from(this.discoveredPeers.keys()).some(
        (id) => !/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(id)
      );
      if (hasRealPeer) {
        this.radioStatus = 'connected';
        this.notifyListeners();
        return;
      }
    } else {
      for (const key of this.discoveredPeers.keys()) {
        if (/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(key)) {
          this.discoveredPeers.delete(key);
        }
      }
    }

    const shortId = peerId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
    const tag = customTag || `Node #${shortId || 'PEER'}`;

    this.discoveredPeers.set(peerId, {
      peerId,
      tag,
      status,
      rssi,
      lastSeen: Date.now(),
    });

    this.radioStatus = 'connected';
    this.notifyListeners();
  }

  async sendMessage(
    peerId: string,
    content: string,
    senderId: string = 'me'
  ): Promise<MessageRecord> {
    if (!this.identity) {
      await this.initialize();
    }

    const messageId = Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();

    const newMessage: MessageRecord = {
      id: messageId,
      peer_id: peerId,
      sender: senderId,
      content: content,
      timestamp,
      status: 'pending',
    };
    await insertMessage(newMessage);

    const displayName = await getDisplayName();
    const structuredPayload = JSON.stringify({ name: displayName, text: content, room: peerId });

    const sealedPayload = sealDirectMessage({
      sender: this.identity!,
      recipientXPublic: GLOBAL_ROOM_X_PUBLIC,
      body: structuredPayload,
    });

    const envelopeBytes = packEnvelope({
      type: EnvelopeType.Sealed,
      payload: sealedPayload,
    });

    this.dispatcher?.dispatchOutgoing(envelopeBytes);

    await updateMessageStatus(messageId, 'relayed');
    newMessage.status = 'relayed';
    this.notifyListeners();
    return newMessage;
  }

  private async handleIncomingEnvelope(rawEnvelopeBytes: Uint8Array): Promise<void> {
    try {
      if (!this.identity) return;

      const unpacked = unpackEnvelope(rawEnvelopeBytes);
      if (unpacked.header.type !== EnvelopeType.Sealed) return;

      let decrypted;
      try {
        const sharedChannelRecipient: IdentityKeyPair = {
          ...this.identity,
          xSecret: GLOBAL_ROOM_X_SECRET,
          xPublic: GLOBAL_ROOM_X_PUBLIC,
        };
        decrypted = openDirectMessage({
          recipient: sharedChannelRecipient,
          packedPayload: unpacked.payload,
        });
      } catch {
        decrypted = openDirectMessage({
          recipient: this.identity,
          packedPayload: unpacked.payload,
        });
      }

      const myEdPublicHex = bytesToHex(this.identity.edPublic);
      if (decrypted.senderPublicId === myEdPublicHex) {
        return;
      }

      this.recordPeerSeen(decrypted.senderPublicId, 'Direct Peer');

      let actualContent = decrypted.body;
      let senderName = decrypted.senderPublicId;
      let targetRoom = 'global_mesh_room';

      try {
        const parsedBody = JSON.parse(decrypted.body);
        if (parsedBody.text && parsedBody.name) {
          actualContent = parsedBody.text;
          senderName = parsedBody.name;
          if (parsedBody.room) {
            targetRoom = parsedBody.room;
          }
        }
      } catch (e) {
      }

      const envelopeIdHex = bytesToHex(unpacked.header.envelopeId);
      const incomingMessage: MessageRecord = {
        id: envelopeIdHex,
        peer_id: targetRoom,
        sender: senderName,
        content: actualContent,
        timestamp: unpacked.header.timestamp,
        status: 'delivered',
      };

      try {
        await insertMessage(incomingMessage);
      } catch (insertErr) {
        console.error('[MeshService] Error inserting incoming message:', insertErr);
      }
      this.notifyListeners();
    } catch (err) {
      console.warn('[MeshService] Decryption or verification dropped packet:', err);
    }
  }

  subscribe(callback: () => void): () => void {
    this.onMessageListeners.push(callback);
    return () => {
      this.onMessageListeners = this.onMessageListeners.filter((cb) => cb !== callback);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.onMessageListeners) {
      listener();
    }
  }

  async onMessageReceived(text: string, senderPeerId: string = 'global_mesh_room'): Promise<void> {
    if (!this.identity) await this.initialize();

    const simulatedMessage: MessageRecord = {
      id: Math.random().toString(36).substring(2, 15),
      peer_id: senderPeerId,
      sender: 'peer_node',
      content: text,
      timestamp: Date.now(),
      status: 'delivered',
    };

    await insertMessage(simulatedMessage);
    this.notifyListeners();
  }

  getRadioStatus(): RadioStatus {
    return this.radioStatus;
  }

  getMyNodeId(): string {
    if (!this.identity) return 'Initializing...';
    return bytesToHex(this.identity.edPublic);
  }

  getDiscoveredPeers(): DiscoveredPeer[] {
    return Array.from(this.discoveredPeers.values());
  }

  pulseScanner(): void {
    this.startNativeRadio();
  }
}

export const MeshService = new MasterMeshService();