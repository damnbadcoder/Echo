import { test, expect } from 'vitest';
import { EventEmitter } from 'events';
import { EnvelopeDispatcher, ITransport } from '../dispatcher';
import { packEnvelope, EnvelopeType } from '../protocol';

// ==========================================
// 1. THE FAKE RADIO (Mocking Dev 1)
// ==========================================
// We build a dummy class that implements the ITransport contract.
class MockTransport implements ITransport {
  private emitter = new EventEmitter(); // Think of this as the radio's speaker

  constructor(private sharedAirwaves: EventEmitter, private myChannel: string) {
    // Listen to the shared airwaves. If a message comes on my channel, play it on my speaker.
    this.sharedAirwaves.on(this.myChannel, (data: Uint8Array) => this.emitter.emit('payload', data));
  }

  // When our Dispatcher calls send(), broadcast it to the other person's channel
  send(payload: Uint8Array): void {
    const destination = this.myChannel === 'to_bob' ? 'to_alice' : 'to_bob';
    this.sharedAirwaves.emit(destination, payload);
  }

  // When our Dispatcher calls on(), connect it to the radio's speaker
  on(event: 'payload', callback: (data: Uint8Array) => void): void {
    this.emitter.on(event, callback);
  }
}

// ==========================================
// 2. THE SIMULATION
// ==========================================
test('Dispatcher sends envelope from Alice to Bob and drops duplicates', () => {
  // 1. Set up the invisible shared airwaves
  const radioAirwaves = new EventEmitter();

  // 2. Set up a list to act as Bob's UI (Dev 4). 
  // We will push messages here to prove they successfully passed Bob's bouncer.
  const bobDelivered: Uint8Array[] = [];

  // 3. Create Alice and Bob's Dispatchers, plugging in their fake radios
  const aliceDispatcher = new EnvelopeDispatcher(
    new MockTransport(radioAirwaves, 'to_alice'), 
    () => {} // We don't care about Alice's UI for this test
  );
  
  const bobDispatcher = new EnvelopeDispatcher(
    new MockTransport(radioAirwaves, 'to_bob'), 
    (env) => bobDelivered.push(env) // Deliver to Bob's UI list
  );

  // 4. Create a dummy message
  const sampleEnvelope = packEnvelope({
    type: EnvelopeType.Sealed,
    payload: new TextEncoder().encode('secret_encrypted_data'),
  });

  // --- THE ACTION ---

  // A. Alice sends the message
  aliceDispatcher.dispatchOutgoing(sampleEnvelope);

  // B. JUnit style assertion: Verify Bob received it exactly once
  expect(bobDelivered.length).toBe(1);

  // C. Simulate a network glitch: Bob's radio receives the exact same raw envelope again
  const acceptedAgain = bobDispatcher.handleIncoming(sampleEnvelope);

  // D. Verify the Bouncer did its job!
  expect(acceptedAgain).toBe(false);   // The method should return false (dropped)
  expect(bobDelivered.length).toBe(1); // Still only 1 message in Bob's UI list
});