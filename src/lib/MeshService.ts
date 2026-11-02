import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Platform } from "react-native";
import { base64ToBytes, bytesToBase64 } from "./base64";
import {
  getOrCreateIdentity,
  IdentityKeyPair,
  openDirectMessage,
  sealDirectMessage,
} from "./crypto-core";
import { EnvelopeDispatcher, ITransport } from "./dispatcher";
import { EnvelopeType, packEnvelope, unpackEnvelope } from "./protocol";
import { insertMessage, MessageRecord, updateMessageStatus } from "./store";

export type RadioStatus = "scanning" | "connecting" | "connected" | "off";

export interface DiscoveredPeer {
  peerId: string;
  tag: string;
  status: "In Range" | "Direct Peer";
  rssi?: number;
  lastSeen: number;
}

let BleMeshModule: any = null;
try {
  if (Platform.OS !== "web") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BleMeshModule = require("../../modules/ble-mesh").default;
  }
} catch {
  console.warn("BleMesh active module not found, running in mock mode.");
}

class MasterMeshService {
  private identity: IdentityKeyPair | null = null;
  private dispatcher: EnvelopeDispatcher | null = null;
  private onMessageListeners: Array<() => void> = [];
  private radioStatus: RadioStatus = "scanning";
  private discoveredPeers: Map<string, DiscoveredPeer> = new Map();
  private isInitialized: boolean = false;

  // ISSUE 8 LOGIC: Store all channels the user has joined
  private subscribedChannels: Set<string> = new Set(["global_mesh_room"]);

  async initialize(): Promise<void> {
    if (this.isInitialized && this.identity) {
      return;
    }

    console.log("[MeshService] Initializing...");
    try {
      this.identity = await getOrCreateIdentity();
    } catch (err) {
      console.error("[MeshService] Error loading identity:", err);
    }

    const transportBridge: ITransport = {
      send: (bytes: Uint8Array) => {
        if (BleMeshModule?.writeRaw) {
          const b64 = bytesToBase64(bytes);
          BleMeshModule.writeRaw("broadcast", b64);
        }
      },
      on: (_event: "payload", callback: (data: Uint8Array) => void) => {
        if (BleMeshModule?.addListener) {
          BleMeshModule.addListener(
            "onRawData",
            (evt: {
              peerId?: string;
              base64Bytes?: string;
              payload?: string;
            }) => {
              const b64 = evt.base64Bytes || evt.payload;
              if (!b64) return;
              if (evt.peerId) {
                this.recordPeerSeen(evt.peerId, "Direct Peer");
              }
              const raw = base64ToBytes(b64);
              callback(raw);
            },
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
  }

  private startNativeRadio(): void {
    if (BleMeshModule?.startRadio) {
      try {
        this.radioStatus = "scanning";
        BleMeshModule.startRadio();
      } catch (err) {
        console.warn("[MeshService] Failed to start radio:", err);
        this.radioStatus = "off";
      }
    } else {
      this.radioStatus = "scanning";
    }
    this.notifyListeners();
  }

  private attachDiscoveryListeners(): void {
    if (!BleMeshModule?.addListener) return;
    try {
      BleMeshModule.addListener(
        "onPeerDiscovered",
        (evt: {
          peerId?: string;
          id?: string;
          rssi?: number;
          tag?: string;
        }) => {
          const id = evt.peerId || evt.id;
          if (id) this.recordPeerSeen(id, "In Range", evt.rssi, evt.tag);
        },
      );

      BleMeshModule.addListener(
        "onPeerConnected",
        (evt: { peerId?: string; id?: string }) => {
          const id = evt.peerId || evt.id;
          if (id) this.recordPeerSeen(id, "Direct Peer");
          this.radioStatus = "connected";
          this.notifyListeners();
        },
      );

      BleMeshModule.addListener(
        "onPeerDisconnected",
        (evt: { peerId?: string; id?: string }) => {
          const id = evt.peerId || evt.id;
          if (id) {
            this.discoveredPeers.delete(id);
            if (/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(id)) {
              if (this.discoveredPeers.size <= 1) this.discoveredPeers.clear();
            }
          }
          this.radioStatus =
            this.discoveredPeers.size > 0 ? "connected" : "scanning";
          this.notifyListeners();
        },
      );
    } catch {}
  }

  private recordPeerSeen(
    peerId: string,
    status: "In Range" | "Direct Peer",
    rssi?: number,
    customTag?: string,
  ): void {
    const isMacAddress = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(
      peerId,
    );

    if (isMacAddress) {
      const hasRealPeer = Array.from(this.discoveredPeers.keys()).some(
        (id) => !/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(id),
      );
      if (hasRealPeer) {
        this.radioStatus = "connected";
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

    const shortId = peerId
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-4)
      .toUpperCase();
    const tag = customTag || `Node #${shortId || "PEER"}`;

    this.discoveredPeers.set(peerId, {
      peerId,
      tag,
      status,
      rssi,
      lastSeen: Date.now(),
    });

    this.radioStatus = "connected";
    this.notifyListeners();
  }

  // ISSUE 8 LOGIC: Add methods to manage channel subscriptions
  joinChannel(channelId: string) {
    this.subscribedChannels.add(channelId);
    this.notifyListeners();
  }

  leaveChannel(channelId: string) {
    this.subscribedChannels.delete(channelId);
    this.notifyListeners();
  }

  getSubscribedChannels(): string[] {
    return Array.from(this.subscribedChannels);
  }

  async sendMessage(
    peerId: string,
    content: string,
    senderId: string = "me",
  ): Promise<MessageRecord> {
    if (!this.identity) await this.initialize();

    const messageId = Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();

    const newMessage: MessageRecord = {
      id: messageId,
      peer_id: peerId, // Automatically routes to the correct channel or direct peer
      sender: senderId,
      content: content,
      timestamp,
      status: "pending",
    };
    await insertMessage(newMessage);

    // ISSUE 8 LOGIC: Dynamically generate the shared key for the requested room
    const seed = new TextEncoder().encode(`chitchatchit:channel:${peerId}:v1`);
    const dynamicRoomXPublic = x25519.getPublicKey(sha256(seed));

    const sealedPayload = sealDirectMessage({
      sender: this.identity!,
      recipientXPublic: dynamicRoomXPublic,
      body: content,
    });

    const envelopeBytes = packEnvelope({
      type: EnvelopeType.Sealed,
      payload: sealedPayload,
    });

    this.dispatcher?.dispatchOutgoing(envelopeBytes);

    await updateMessageStatus(messageId, "relayed");
    newMessage.status = "relayed";
    this.notifyListeners();
    return newMessage;
  }

  private async handleIncomingEnvelope(
    rawEnvelopeBytes: Uint8Array,
  ): Promise<void> {
    try {
      if (!this.identity) return;

      const unpacked = unpackEnvelope(rawEnvelopeBytes);
      if (unpacked.header.type !== EnvelopeType.Sealed) return;

      let decrypted;
      let matchedChannel = "direct_message";

      // 1. Try personal key first (for Direct Messages)
      try {
        decrypted = openDirectMessage({
          recipient: this.identity,
          packedPayload: unpacked.payload,
        });
      } catch {
        // 2. ISSUE 8 LOGIC: Try all subscribed channels to see if the packet fits one of our rooms
        for (const channel of this.subscribedChannels) {
          try {
            const seed = new TextEncoder().encode(
              `chitchatchit:channel:${channel}:v1`,
            );
            const channelXSecret = sha256(seed);

            const sharedChannelRecipient = {
              ...this.identity,
              xSecret: channelXSecret,
              xPublic: x25519.getPublicKey(channelXSecret),
            };

            decrypted = openDirectMessage({
              recipient: sharedChannelRecipient,
              packedPayload: unpacked.payload,
            });

            matchedChannel = channel;
            break; // Stop looping once successfully decrypted
          } catch {
            // Wrong channel, continue looping
          }
        }
      }

      // If it still couldn't decrypt, the packet wasn't meant for us or our rooms
      if (!decrypted) return;

      const myEdPublicHex = bytesToHex(this.identity.edPublic);
      if (decrypted.senderPublicId === myEdPublicHex) return;

      this.recordPeerSeen(decrypted.senderPublicId, "Direct Peer");

      const envelopeIdHex = bytesToHex(unpacked.header.envelopeId);
      const incomingMessage: MessageRecord = {
        id: envelopeIdHex,
        peer_id: matchedChannel, // Assigns it to the correct UI channel
        sender: decrypted.senderPublicId,
        content: decrypted.body,
        timestamp: unpacked.header.timestamp,
        status: "delivered",
      };

      try {
        await insertMessage(incomingMessage);
      } catch (insertErr) {
        console.error(
          "[MeshService] Error inserting incoming message:",
          insertErr,
        );
      }
      this.notifyListeners();
    } catch (err) {
      console.warn(
        "[MeshService] Decryption or verification dropped packet:",
        err,
      );
    }
  }

  subscribe(callback: () => void): () => void {
    this.onMessageListeners.push(callback);
    return () => {
      this.onMessageListeners = this.onMessageListeners.filter(
        (cb) => cb !== callback,
      );
    };
  }

  private notifyListeners(): void {
    for (const listener of this.onMessageListeners) {
      listener();
    }
  }

  async onMessageReceived(
    text: string,
    senderPeerId: string = "global_mesh_room",
  ): Promise<void> {
    if (!this.identity) await this.initialize();

    const simulatedMessage: MessageRecord = {
      id: Math.random().toString(36).substring(2, 15),
      peer_id: senderPeerId,
      sender: "peer_node",
      content: text,
      timestamp: Date.now(),
      status: "delivered",
    };

    await insertMessage(simulatedMessage);
    this.notifyListeners();
  }

  getRadioStatus(): RadioStatus {
    return this.radioStatus;
  }

  getMyNodeId(): string {
    if (!this.identity) return "Initializing...";
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
