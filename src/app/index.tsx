// src/app/index.tsx
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeshService, RadioStatus } from '../lib/MeshService';
import { MessageRecord, getMessagesForPeer } from '../lib/store';

// Default public room ID used when the app opens normally
const DEFAULT_PEER_ID = 'global_mesh_room';

export default function ChatScreen() {
  /*
   * useLocalSearchParams reads any route parameters passed when navigating from the Discover screen.
   * Why required: When a user clicks "Message" on a detected Bluetooth peer in discover.tsx,
   * it passes that peer's ID here. If no peer was clicked yet, we fall back to 'global_mesh_room'.
   */
  const params = useLocalSearchParams<{ peer?: string }>();
  const activePeerId =
    typeof params.peer === 'string' && params.peer.length > 0
      ? params.peer
      : DEFAULT_PEER_ID;

  // 1. State to store the array of chat messages loaded from local SQLite database
  const [messages, setMessages] = useState<MessageRecord[]>([]);

  // 2. State to store the text currently typed inside the bottom input box
  const [inputText, setInputText] = useState('');

  // 3. State to track live Bluetooth radio status ('scanning' | 'connecting' | 'connected' | 'off')
  // Why required: Solves Problem D so the screen gives live visual feedback on radio state
  const [radioState, setRadioState] = useState<RadioStatus>('scanning');

  // 4. State to track how many nearby phones have been detected over Bluetooth
  const [peerCount, setPeerCount] = useState<number>(0);

  /*
   * Function to load stored messages from SQLite and check the latest radio status from MeshService.
   * Wrapped in useCallback so React keeps the same function reference unless activePeerId changes.
   */
  const loadMessages = useCallback(async () => {
    // Fetch all messages for this room/peer from SQLite (ordered newest first)
    const storedMessages = await getMessagesForPeer(activePeerId);
    setMessages(storedMessages);

    // Directly read the current radio state and discovered peer count from MeshService (added in Step 1)
    setRadioState(MeshService.getRadioStatus());
    setPeerCount(MeshService.getDiscoveredPeers().length);
  }, [activePeerId]);

  // useEffect runs when the screen opens to start MeshService and keep messages updated
  useEffect(() => {
    // 1. Initialize identity keys and Bluetooth radio, then load messages from SQLite
    MeshService.initialize().then(() => {
      loadMessages();
    });

    // 2. Subscribe to MeshService so whenever a new Bluetooth message arrives, the screen updates immediately
    const unsubscribe = MeshService.subscribe(() => {
      loadMessages();
    });

    // 3. Poll every 2 seconds as a backup to refresh messages and connection status
    const interval = setInterval(() => {
      loadMessages();
    }, 2000);

    // Cleanup function: stops the timer and removes listener when leaving the screen
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [loadMessages]);

  // Function called when the user taps the "Send" button
  const handleSend = async () => {
    // Do nothing if the text box is empty or only contains spaces
    if (inputText.trim() === '') return;

    // Send the message through MeshService (which saves to SQLite, encrypts with shared room key, and broadcasts over BLE)
    await MeshService.sendMessage(activePeerId, inputText.trim(), 'me');

    // Clear the input box and refresh the chat list
    setInputText('');
    loadMessages();
  };

  /*
   * Helper function that returns the icon, text label, and colors for the top connection pill.
   * Why required: Solves Problem D (Missing Connection Feedback in the UI).
   */
  const getStatusBadge = () => {
    if (radioState === 'off') {
      return {
        dot: '🔴',
        label: 'Radio Disconnected',
        bg: '#FEE2E2',
        text: '#991B1B',
      };
    }
    if (peerCount > 0 || radioState === 'connected') {
      return {
        dot: '🟢',
        label: `Connected (${peerCount > 0 ? `${peerCount} peer${peerCount > 1 ? 's' : ''}` : 'Mesh Active'})`,
        bg: '#DCFCE7',
        text: '#166534',
      };
    }
    if (radioState === 'connecting') {
      return {
        dot: '🟡',
        label: 'Connecting / Handshake...',
        bg: '#FEF9C3',
        text: '#854D0E',
      };
    }
    return {
      dot: '🟢',
      label: 'Scanning for nearby BLE peers...',
      bg: '#E0F2FE',
      text: '#075985',
    };
  };

  const statusBadge = getStatusBadge();
  const isPublicRoom = activePeerId === 'global_mesh_room';

  // Function to render each individual message bubble inside the FlatList
  const renderMessage = ({ item }: { item: MessageRecord }) => {
    // Check if the message was sent by us ('me') or received from another phone
    const isMe = item.sender === 'me';

    return (
      <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.peerMessage]}>
        {/* If received from another phone, show their shortened cryptographic sender ID at the top of the bubble */}
        {!isMe && (
          <Text style={styles.senderLabel}>
            {item.sender.length > 12
              ? `${item.sender.slice(0, 6)}...${item.sender.slice(-4)}`
              : item.sender}
          </Text>
        )}

        {/* Main message text */}
        <Text style={isMe ? styles.myMessageText : styles.peerMessageText}>
          {item.content}
        </Text>

        {/* Message time (e.g. 06:45 PM) and delivery status tick ('pending' | 'relayed' | 'delivered') */}
        <Text style={[styles.timestamp, !isMe && styles.peerTimestamp]}>
          {new Date(item.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {isMe && ` • ${item.status}`}
        </Text>
      </View>
    );
  };

  return (
    // SafeAreaView prevents the top header from overlapping with the phone's notch or status bar clock
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* TOP HEADER: Displays Room Name + Live Radio Connection Status Pill (Problem D) */}
        <View style={styles.headerContainer}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.roomTitle}>
              {isPublicRoom ? '#global_mesh_room' : `Peer: ${activePeerId.slice(0, 10)}`}
            </Text>

            {/* Live Connection Status Badge (Scanning / Connecting / Connected / Disconnected) */}
            <View style={[styles.statusPill, { backgroundColor: statusBadge.bg }]}>
              <Text style={[styles.statusPillText, { color: statusBadge.text }]}>
                {statusBadge.dot} {statusBadge.label}
              </Text>
            </View>
          </View>

          {/* Security notice banner reminding user that #global_mesh_room uses a shared channel key */}
          {isPublicRoom && (
            <View style={styles.securityBanner}>
              <Text style={styles.securityBannerText}>
                ⚠️ Public Mesh Channel • Shared channel key with Ed25519 sender verification
              </Text>
            </View>
          )}
        </View>

        {/* INVERTED FLATLIST: Renders newest messages at the bottom of the screen */}
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          inverted={true}
          contentContainerStyle={styles.listContent}
        />

        {/* MESSAGE INPUT AREA */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor="#999999"
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Styles for the header, connection badge, chat bubbles, and bottom input bar
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  headerContainer: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  roomTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#111827',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  securityBanner: {
    marginTop: 8,
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  securityBannerText: {
    fontSize: 11,
    color: '#92400E',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginVertical: 4,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
    borderBottomRightRadius: 4,
  },
  peerMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#E5E5EA',
    borderBottomLeftRadius: 4,
  },
  senderLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#4B5563',
    marginBottom: 2,
  },
  myMessageText: {
    color: '#ffffff',
    fontSize: 16,
  },
  peerMessageText: {
    color: '#000000',
    fontSize: 16,
  },
  timestamp: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  peerTimestamp: {
    color: '#6B7280',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderColor: '#e5e5e5',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
    color: '#111111',
  },
  sendButton: {
    marginLeft: 12,
    backgroundColor: '#007AFF',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});