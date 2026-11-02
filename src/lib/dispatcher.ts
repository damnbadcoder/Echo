// ==========================================
// 1. DATA CONTRACTS
// ==========================================

// Defines the shape of the message object

import { bytesToHex } from '@noble/hashes/utils.js';
import { unpackEnvelope } from "./protocol";

export interface Envelope {
  id: string;
  payload: string;
  hopCount: number;
}

// Defines how we interact with Dev 1's Radio
export interface ITransport {
  send(payload: Uint8Array): void;
  on(event: 'payload', callback: (data: Uint8Array) => void): void;
}


// ==========================================
// 2. THE DISPATCHER COMPONENT
// ==========================================

export class EnvelopeDispatcher {
  // The 'Bouncer Notepad': Tracks IDs we have already processed
  private seen: Set<string> = new Set();

  // The Waiting Line: Holds messages waiting to be sent
  private outgoingQueue: Uint8Array[] = [];

  // Injects the radio (transport) and the UI delivery function
  constructor(
    private transport: ITransport, 
    private onDeliverToApp: (rawEnvelopeBytes: Uint8Array) => void
  ) {
    // Listen to the radio's 'payload' channel and route data to handleIncoming
    this.transport.on('payload', (rawBytes) => this.handleIncoming(rawBytes));
  }

  /**
   * ACTION 1: SENDING OUT (Alice -> Radio)
   * Takes an Envelope, logs it, queues it, and broadcasts it.
   */
  public dispatchOutgoing(envelopeBytes: Uint8Array): void {
    try {
      const unpacked = unpackEnvelope(envelopeBytes);
      const envelopeIdHex = bytesToHex(unpacked.header.envelopeId);

      this.seen.add(envelopeIdHex);
      this.outgoingQueue.push(envelopeBytes);
      this.transport.send(envelopeBytes);
    } catch (error) {
      console.error('Error dispatching outgoing envelope:', error);
    }
  }

  /**
   * ACTION 2: RECEIVING (Radio -> Bob)
   * Receives a raw string, inflates it, drops duplicates, and delivers to UI.
   */
  public handleIncoming(rawEnvelopeBytes: Uint8Array): boolean {

    try {
      const unpacked = unpackEnvelope(rawEnvelopeBytes);
        const envelopeIdHex = bytesToHex(unpacked.header.envelopeId);

        if (this.seen.has(envelopeIdHex)) {
          return false;
        }

        this.seen.add(envelopeIdHex);
        this.onDeliverToApp(rawEnvelopeBytes);
        return true;
    } catch (error) {
      return false;
    }
  }
}