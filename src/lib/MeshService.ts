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
import { insertMessage, updateMessageStatus, MessageRecord, getDisplayName, saveRoom } from './store';
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
  private macToPeerIdMap: Map<string, string> = new Map();
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
          // Stagger chunk dispatches by 60ms so Android BLE hardware buffer does not drop consecutive writes
          chunks.forEach((chunk, index) => {
            const b64 = bytesToBase64(chunk);
            if (index === 0) {
              BleMeshModule.writeRaw('broadcast', b64);
            } else {
              setTimeout(() => {
                BleMeshModule.writeRaw('broadcast', b64);
              }, index * 60);
            }
          });
        } else {
          console.log('[MeshService] (Radio Mock) Transmitted', chunks.length, 'chunks');
        }
      },
      on: (_event: 'payload', callback: (data: Uint8Array, sourcePeerId?: string) => void) => {
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
                callback(completeEnvelope, evt.peerId);
              }
            }
          );
        }
      },
    };

    this.dispatcher = new EnvelopeDispatcher(transportBridge, (rawEnvelope, sourcePeerId) => {
      this.handleIncomingEnvelope(rawEnvelope, sourcePeerId);
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

          // Broadcast our display name so connected peer immediately sees our name
          setTimeout(() => {
            this.broadcastPresence();
          }, 800);
        }
      );

      BleMeshModule.addListener(
        'onPeerDisconnected',
        (evt: { peerId?: string; id?: string }) => {
          const id = evt.peerId || evt.id;
          if (id) {
            this.discoveredPeers.delete(id);
            const canonicalId = this.macToPeerIdMap.get(id);
            if (canonicalId) {
              this.discoveredPeers.delete(canonicalId);
              this.macToPeerIdMap.delete(id);
            }
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

    // If this MAC is already mapped to a canonical peer, update that canonical peer instead
    const canonicalId = (isMacAddress && this.macToPeerIdMap.has(peerId))
      ? this.macToPeerIdMap.get(peerId)!
      : peerId;

    // If this is a MAC address and we already have a canonical peer recorded for it, update RSSI/status and don't re-add MAC
    if (isMacAddress && canonicalId !== peerId && this.discoveredPeers.has(canonicalId)) {
      const canonicalPeer = this.discoveredPeers.get(canonicalId)!;
      if (typeof rssi === 'number') canonicalPeer.rssi = rssi;
      canonicalPeer.lastSeen = Date.now();
      if (status === 'Direct Peer') canonicalPeer.status = 'Direct Peer';
      this.notifyListeners();
      return;
    }

    const shortId = canonicalId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
    const fallbackTag = `Node #${shortId || 'PEER'}`;

    const existing = this.discoveredPeers.get(canonicalId);
    const tag = customTag || existing?.tag || fallbackTag;

    this.discoveredPeers.set(canonicalId, {
      peerId: canonicalId,
      tag,
      status: status || existing?.status || 'In Range',
      rssi: typeof rssi === 'number' ? rssi : existing?.rssi,
      lastSeen: Date.now(),
    });

    // Remove any placeholder/ghost entry that belongs to this peer
    for (const [key, p] of this.discoveredPeers.entries()) {
      if (key !== canonicalId) {
        if (
          this.macToPeerIdMap.get(key) === canonicalId ||
          (customTag && !customTag.startsWith('Node #') && p.tag === customTag)
        ) {
          this.discoveredPeers.delete(key);
        }
      }
    }

    this.radioStatus = 'connected';
    this.notifyListeners();
  }

  async broadcastPresence(): Promise<void> {
    try {
      if (!this.identity) await this.initialize();
      if (!this.identity) return;

      const displayName = (await getDisplayName()) || 'Anonymous';
      const payload = JSON.stringify({
        type: 'presence',
        name: displayName,
        senderId: this.getMyNodeId(),
      });

      const sealedPayload = sealDirectMessage({
        sender: this.identity,
        recipientXPublic: GLOBAL_ROOM_X_PUBLIC,
        body: payload,
      });

      const envelopeBytes = packEnvelope({
        type: EnvelopeType.Sealed,
        payload: sealedPayload,
      });

      this.dispatcher?.dispatchOutgoing(envelopeBytes);
    } catch (err) {
      console.warn('[MeshService] Error broadcasting presence:', err);
    }
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

    const isPublicRoom = peerId === 'global_mesh_room';
    const isChannel = !isPublicRoom && !peerId.includes(':') && peerId.length < 30;
    const cleanPeerId = isChannel ? peerId.toLowerCase().replace(/^#+/, '').trim() : peerId;

    const newMessage: MessageRecord = {
      id: messageId,
      peer_id: cleanPeerId,
      sender: senderId,
      content: content,
      timestamp,
      status: 'pending',
    };
    await insertMessage(newMessage);

    if (isChannel) {
      await saveRoom(cleanPeerId);
    }

    const displayName = (await getDisplayName()) || 'Anonymous';
    const myNodeId = this.getMyNodeId();
    const structuredPayload = JSON.stringify({
      type: 'message',
      name: displayName,
      text: content,
      room: cleanPeerId,
      senderId: myNodeId,
    });

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

  private async handleIncomingEnvelope(rawEnvelopeBytes: Uint8Array, sourcePeerId?: string): Promise<void> {
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

      let actualContent = decrypted.body;
      let senderName = decrypted.senderPublicId;
      let targetRoom = 'global_mesh_room';
      let payloadType = 'message';
      let senderNodeId = decrypted.senderPublicId;

      try {
        const parsedBody = JSON.parse(decrypted.body);
        if (parsedBody && typeof parsedBody === 'object') {
          if (parsedBody.type === 'presence') {
            payloadType = 'presence';
          }
          if (typeof parsedBody.text === 'string') {
            actualContent = parsedBody.text;
          }
          if (typeof parsedBody.name === 'string' && parsedBody.name.trim().length > 0) {
            senderName = parsedBody.name.trim();
          }
          if (typeof parsedBody.room === 'string' && parsedBody.room.trim().length > 0) {
            targetRoom = parsedBody.room.trim();
          }
          if (typeof parsedBody.senderId === 'string' && parsedBody.senderId.trim().length > 0) {
            senderNodeId = parsedBody.senderId.trim();
          }
        }
      } catch (e) {
      }

      // Map the physical source MAC address to this peer's cryptographic public key
      let existingRssi: number | undefined;
      if (sourcePeerId) {
        this.macToPeerIdMap.set(sourcePeerId, decrypted.senderPublicId);
        const macEntry = this.discoveredPeers.get(sourcePeerId);
        if (macEntry) {
          existingRssi = macEntry.rssi;
          this.discoveredPeers.delete(sourcePeerId);
        }
      }

      // Record ONLY the canonical cryptographic peer ID (never duplicate MAC and Public ID)
      this.recordPeerSeen(decrypted.senderPublicId, 'Direct Peer', existingRssi, senderName);

      // Presence broadcasts only sync node discovery, do not persist to messages table
      if (payloadType === 'presence') {
        this.notifyListeners();
        return;
      }

      const envelopeIdHex = bytesToHex(unpacked.header.envelopeId);
      const isPublicRoom = targetRoom === 'global_mesh_room';
      const isChannel = !isPublicRoom && !targetRoom.includes(':') && targetRoom.length < 30;

      if (isPublicRoom) {
        const incomingMessage: MessageRecord = {
          id: envelopeIdHex,
          peer_id: 'global_mesh_room',
          sender: senderName,
          content: actualContent,
          timestamp: Date.now(),
          status: 'delivered',
        };
        await insertMessage(incomingMessage);
      } else if (isChannel) {
        const cleanChannel = targetRoom.toLowerCase().replace(/^#+/, '').trim();
        const incomingMessage: MessageRecord = {
          id: envelopeIdHex,
          peer_id: cleanChannel,
          sender: senderName,
          content: actualContent,
          timestamp: Date.now(),
          status: 'delivered',
        };
        await insertMessage(incomingMessage);

        // Ensure channel is saved in local saved_rooms
        await saveRoom(cleanChannel);
      } else {
        // Direct 1-on-1 message!
        // To this recipient, the conversation thread belongs to the sender:
        const incomingMessage: MessageRecord = {
          id: envelopeIdHex,
          peer_id: decrypted.senderPublicId,
          sender: senderName,
          content: actualContent,
          timestamp: Date.now(),
          status: 'delivered',
        };
        await insertMessage(incomingMessage);

        // Also store aliased for the physical sourcePeerId (BLE MAC) so chat opened by MAC shows message
        if (sourcePeerId && sourcePeerId !== decrypted.senderPublicId) {
          await insertMessage({
            ...incomingMessage,
            id: `${envelopeIdHex}_alias`,
            peer_id: sourcePeerId,
          });
        }
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
    const unique = new Map<string, DiscoveredPeer>();
    for (const peer of this.discoveredPeers.values()) {
      // If this entry is a MAC address already mapped to a canonical peer, skip it
      if (
        /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(peer.peerId) &&
        this.macToPeerIdMap.has(peer.peerId)
      ) {
        continue;
      }
      // Deduplicate by tag if it's a real name, otherwise by peerId
      const dedupKey =
        peer.tag && !peer.tag.startsWith('Node #') && peer.tag !== 'Anonymous'
          ? `tag:${peer.tag.toLowerCase().trim()}`
          : `id:${peer.peerId}`;

      if (!unique.has(dedupKey)) {
        unique.set(dedupKey, peer);
      }
    }
    return Array.from(unique.values());
  }

  getPeerInfo(peerId: string): DiscoveredPeer | undefined {
    const canonicalId = this.macToPeerIdMap.get(peerId) || peerId;
    return this.discoveredPeers.get(canonicalId) || this.discoveredPeers.get(peerId);
  }

  pulseScanner(): void {
    if (BleMeshModule?.stopRadio && BleMeshModule?.startRadio) {
      try {
        BleMeshModule.stopRadio();
      } catch {}
      setTimeout(() => {
        this.startNativeRadio();
      }, 100);
    } else {
      this.startNativeRadio();
    }
  }
}

export const MeshService = new MasterMeshService();