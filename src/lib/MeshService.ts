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
import { insertMessage, updateMessageStatus, MessageRecord } from './store';

// Type representing the live state of the Bluetooth radio
// Why required: Solves Problem D by letting index.tsx and discover.tsx know if radio is scanning, connecting, connected, or off
export type RadioStatus = 'scanning' | 'connecting' | 'connected' | 'off';

// Interface defining a nearby phone detected over Bluetooth
// Why required: Powers the "Nearby Mesh Peers" list on the Discover screen (Part 3)
export interface DiscoveredPeer {
  peerId: string; // Unique identifier of the detected phone
  tag: string; // Readable name shown in UI (e.g., "Node #E9A1")
  status: 'In Range' | 'Direct Peer'; // Connection state of the peer
  rssi?: number; // Bluetooth signal strength
  lastSeen: number; // Timestamp when this peer was last detected
}

// Load Dev 1's native Bluetooth module safely so Web or Expo Go doesn't crash
let BleMeshModule: any = null;
try {
  if (Platform.OS !== 'web') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BleMeshModule = require('../../modules/ble-mesh').default;
  }
} catch {
  console.warn('BleMesh active module not found, running in mock mode.');
}

/*
 * SHARED CHANNEL KEY FOR global_mesh_room (Solves Problem C: Cryptographic Key Mismatch)
 *
 * What this does:
 * Generates a shared 32-byte X25519 secret key (GLOBAL_ROOM_X_SECRET) using SHA-256 on a fixed room string,
 * and derives its matching X25519 public key (GLOBAL_ROOM_X_PUBLIC).
 *
 * Why required:
 * In the old code (lines 78-82), Phone A encrypted global_mesh_room messages with this.identity.xPublic (Phone A's own key).
 * When Phone B received the packet, Phone B tried to decrypt it with Phone B's private key, which failed and dropped the message!
 * By using this shared channel keypair for global_mesh_room, both Phone A and Phone B can decrypt messages in the public room
 * while openDirectMessage still verifies the sender's personal Ed25519 signature!
 */
const GLOBAL_ROOM_SEED = new TextEncoder().encode(
  'chitchatchit:channel:global_mesh_room:v1'
);
const GLOBAL_ROOM_X_SECRET = sha256(GLOBAL_ROOM_SEED);
const GLOBAL_ROOM_X_PUBLIC = x25519.getPublicKey(GLOBAL_ROOM_X_SECRET);

class MasterMeshService {
  // Stores this phone's cryptographic keypair loaded from SecureStore
  private identity: IdentityKeyPair | null = null;

  // Stores Dev 3's gossip dispatcher for deduplication and queueing
  private dispatcher: EnvelopeDispatcher | null = null;

  // List of UI callback functions to notify whenever a message arrives or radio status updates
  private onMessageListeners: Array<() => void> = [];

  // Tracks current radio connection state for the UI banners (Problem D)
  private radioStatus: RadioStatus = 'scanning';

  // Map storing nearby Bluetooth phones detected during scanning
  private discoveredPeers: Map<string, DiscoveredPeer> = new Map();

  // Flag so initialize() doesn't attach duplicate listeners if called more than once
  private isInitialized: boolean = false;

  async initialize(): Promise<void> {
    if (this.isInitialized && this.identity) {
      return;
    }

    console.log('[MeshService] Initializing...');
    // 1. Load or create our Ed25519/X25519 identity keys
    try {
      this.identity = await getOrCreateIdentity();
      console.log('[MeshService] Identity loaded. Public ID:', this.identity.publicId);
    } catch (err) {
      console.error('[MeshService] Error loading identity:', err);
    }
    // 2. Connect Dev 3's ITransport interface (send & on) to Dev 1's BleMeshModule
    const transportBridge: ITransport = {
      send: (bytes: Uint8Array) => {
        if (BleMeshModule?.writeRaw) {
          // Convert binary bytes to Base64 string to send over the React Native bridge
          const b64 = bytesToBase64(bytes);
          BleMeshModule.writeRaw('broadcast', b64);
        } else {
          console.log('[MeshService] (Radio Mock) Transmitted', bytes.length, 'bytes');
        }
      },
      on: (_event: 'payload', callback: (data: Uint8Array) => void) => {
        if (BleMeshModule?.addListener) {
          // Listen for incoming raw Bluetooth data from nearby phones
          BleMeshModule.addListener(
            'onRawData',
            (evt: { peerId?: string; base64Bytes?: string; payload?: string }) => {
              const b64 = evt.base64Bytes || evt.payload;
              if (!b64) return;
              if (evt.peerId) {
                // Mark this phone as a connected Direct Peer in our UI list
                this.recordPeerSeen(evt.peerId, 'Direct Peer');
              }
              const raw = base64ToBytes(b64);
              callback(raw);
            }
          );
        }
      },
    };

    // 3. Create Dev 3's EnvelopeDispatcher to manage packet deduplication and forwarding
    this.dispatcher = new EnvelopeDispatcher(transportBridge, (rawEnvelope) => {
      this.handleIncomingEnvelope(rawEnvelope);
    });

    // 4. Attach peer discovery/connection listeners for the Discover Screen & Chat Header
    this.attachDiscoveryListeners();

    // 5. Start the native Bluetooth radio
    this.startNativeRadio();

    this.isInitialized = true;
    this.notifyListeners();
  }

  // Starts the native Bluetooth radio and updates status for the UI banner
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
      // In mock/testing mode without native BLE, keep status as 'scanning'
      this.radioStatus = 'scanning';
    }
    this.notifyListeners();
  }

  // Listens for native peer discovery/connect/disconnect events if Dev 1's module emits them
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
      // Ignore if optional events are not registered in native module yet
    }
  }

  // Adds or updates a detected phone in discoveredPeers Map and updates radioStatus to 'connected'
  private recordPeerSeen(
    peerId: string,
    status: 'In Range' | 'Direct Peer',
    rssi?: number,
    customTag?: string
  ): void {
    const isMacAddress = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(peerId);

    // If this is a MAC address, but we already have a direct peer with a real public ID,
    // don't create a duplicate ghost peer, but ensure status remains 'connected'.
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
      // If we just learned a real public ID, remove any raw MAC-only placeholder peers
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

    // 1. Save outgoing message to local SQLite table so it shows immediately in the chat list
    const newMessage: MessageRecord = {
      id: messageId,
      peer_id: peerId,
      sender: senderId,
      content: content,
      timestamp,
      status: 'pending',
    };
    await insertMessage(newMessage);

    /*
     * 2. SOLVES PROBLEM C (MeshService.ts:78-82):
     * Instead of encrypting with this.identity!.xPublic (which encrypts to ourselves so Phone B can't read it),
     * we encrypt using GLOBAL_ROOM_X_PUBLIC (the shared channel public key) while signing with our personal Ed25519 key!
     */
    const sealedPayload = sealDirectMessage({
      sender: this.identity!,
      recipientXPublic: GLOBAL_ROOM_X_PUBLIC,
      body: content,
    });

    // 3. Pack into Dev 2's 34-byte binary wire envelope
    const envelopeBytes = packEnvelope({
      type: EnvelopeType.Sealed,
      payload: sealedPayload,
    });

    // 4. Send envelope to Dev 3's dispatcher to transmit over BLE
    this.dispatcher?.dispatchOutgoing(envelopeBytes);

    // Update status to 'relayed' now that the radio has transmitted the packet
    await updateMessageStatus(messageId, 'relayed');
    newMessage.status = 'relayed';
    this.notifyListeners();
    return newMessage;
  }

  private async handleIncomingEnvelope(rawEnvelopeBytes: Uint8Array): Promise<void> {
    try {
      if (!this.identity) return;

      // 1. Unpack the 34-byte wire header and check that it is a Sealed message envelope
      const unpacked = unpackEnvelope(rawEnvelopeBytes);
      if (unpacked.header.type !== EnvelopeType.Sealed) return;

      /*
       * 2. SOLVES PROBLEM C (Decrypting on Phone B):
       * First try unlocking the message with the shared channel key (GLOBAL_ROOM_X_SECRET).
       * If it was encrypted specifically to our personal key instead, fall back to this.identity.
       */
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

      // Check if this packet was sent by our own phone (compare hex of our edPublic key)
      // Note: We only skip self-packets if it wasn't triggered by the local onMessageReceived simulator
      const myEdPublicHex = bytesToHex(this.identity.edPublic);
      if (decrypted.senderPublicId === myEdPublicHex) {
        // Ignore echoed packets from our own radio
        return;
      }

      // Add the sender to our discovered peers list so they appear in the Discover tab & Connected badge
      this.recordPeerSeen(decrypted.senderPublicId, 'Direct Peer');

      const envelopeIdHex = bytesToHex(unpacked.header.envelopeId);
      const incomingMessage: MessageRecord = {
        id: envelopeIdHex,
        peer_id: 'global_mesh_room',
        sender: decrypted.senderPublicId,
        content: decrypted.body,
        timestamp: unpacked.header.timestamp,
        status: 'delivered',
      };

      // 3. Save decrypted message to SQLite and trigger UI refresh
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

  // Subscribe function used by index.tsx and discover.tsx to refresh when new messages/peers arrive
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

  // Developer helper function to test receiving a message without a second phone
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

  // =========================================================================
  // UI HELPER FUNCTIONS FOR DEV 4 (Used in index.tsx and discover.tsx)
  // =========================================================================

  // Returns whether the radio is 'scanning', 'connecting', 'connected', or 'off'
  getRadioStatus(): RadioStatus {
    return this.radioStatus;
  }

  // Returns this phone's own 64-character hex public identity for the "My Node ID" card
  getMyNodeId(): string {
    if (!this.identity) return 'Initializing...';
    return bytesToHex(this.identity.edPublic);
  }

  // Returns the list of nearby phones discovered over Bluetooth
  getDiscoveredPeers(): DiscoveredPeer[] {
    return Array.from(this.discoveredPeers.values());
  }

  // Manually restarts Bluetooth scanning when the user taps "Refresh / Scan" in Discover screen
  pulseScanner(): void {
    this.startNativeRadio();
  }
}

export const MeshService = new MasterMeshService();