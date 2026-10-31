// src/app/chat.tsx
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
import { MessageRecord, getMessagesForPeer, getDisplayName } from '../lib/store';

const DEFAULT_PEER_ID = 'global_mesh_room';

export default function ChatScreen() {
  const params = useLocalSearchParams<{ peer?: string }>();
  const activePeerId =
    typeof params.peer === 'string' && params.peer.length > 0
      ? params.peer
      : DEFAULT_PEER_ID;

  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [inputText, setInputText] = useState('');
  const [radioState, setRadioState] = useState<RadioStatus>('scanning');
  const [peerCount, setPeerCount] = useState<number>(0);
  const [displayName, setDisplayName] = useState<string>('Anonymous');

  const loadMessages = useCallback(async () => {
    try {
      const storedMessages = await getMessagesForPeer(activePeerId);
      setMessages(storedMessages);
      
      const name = await getDisplayName();
      setDisplayName(name);
    } catch (err) {
      console.warn('[ChatScreen] Error loading messages from SQLite:', err);
    } finally {
      setRadioState(MeshService.getRadioStatus());
      setPeerCount(MeshService.getDiscoveredPeers().length);
    }
  }, [activePeerId]);

  useEffect(() => {
    MeshService.initialize().then(() => {
      loadMessages();
    });

    const unsubscribe = MeshService.subscribe(() => {
      loadMessages();
    });

    const interval = setInterval(() => {
      loadMessages();
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [loadMessages]);

  const handleSend = async () => {
    if (inputText.trim() === '') return;
    
    const textToSend = inputText.trim();
    setInputText('');

    try {
      await MeshService.sendMessage(activePeerId, textToSend, 'me');
      loadMessages();
    } catch (err) {
      console.error('[ChatScreen] Error sending message:', err);
    }
  };

  const getStatusBadge = () => {
    if (radioState === 'off') {
      return { dot: '🔴', label: 'Radio Disconnected', bg: '#FEE2E2', text: '#991B1B' };
    }
    if (peerCount > 0 || radioState === 'connected') {
      return { dot: '🟢', label: `Connected (${peerCount > 0 ? `${peerCount} peer${peerCount > 1 ? 's' : ''}` : 'Mesh Active'})`, bg: '#DCFCE7', text: '#166534' };
    }
    if (radioState === 'connecting') {
      return { dot: '🟡', label: 'Connecting...', bg: '#FEF9C3', text: '#854D0E' };
    }
    return { dot: '🟢', label: 'Scanning for nearby BLE peers...', bg: '#E0F2FE', text: '#075985' };
  };

  const statusBadge = getStatusBadge();
  const isPublicRoom = activePeerId === 'global_mesh_room';

  const renderMessage = ({ item }: { item: MessageRecord }) => {
    const isMe = item.sender === 'me';

    return (
      <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.peerMessage]}>
        {!isMe && (
          <Text style={styles.senderLabel}>
            {/* CHANGED (ISSUE 5): Added square brackets around the incoming sender's name */}
            [{item.sender.length > 12
              ? `${item.sender.slice(0, 6)}...${item.sender.slice(-4)}`
              : item.sender}]
          </Text>
        )}

        <Text style={isMe ? styles.myMessageText : styles.peerMessageText}>
          {item.content}
        </Text>

        <Text style={[styles.timestamp, !isMe && styles.peerTimestamp]}>
          {new Date(item.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {isMe && (item.status === 'delivered' ? ' ✓✓' : ' ✓')}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* CHANGED (ISSUE 6): Removed the 90px offset on Android so the keyboard no longer hides the input */}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.headerContainer}>
          <View style={styles.headerTitleRow}>
            {/* CHANGED (ISSUE 1): Replaced '#global_mesh_room' jargon with 'Public Room' */}
            <Text style={styles.roomTitle}>
              {isPublicRoom ? 'Public Room' : `Peer: ${activePeerId.slice(0, 10)}`}
            </Text>
            <View style={[styles.statusPill, { backgroundColor: statusBadge.bg }]}>
              <Text style={[styles.statusPillText, { color: statusBadge.text }]}>
                {statusBadge.dot} {statusBadge.label}
              </Text>
            </View>
          </View>

          {isPublicRoom && (
            <View style={styles.securityBanner}>
              <Text style={styles.securityBannerText}>
                ⚠️ Public Room • Anyone nearby can see these messages
              </Text>
            </View>
          )}
        </View>

        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          inverted={true}
          contentContainerStyle={styles.listContent}
        />

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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#ffffff' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  headerContainer: { backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e5e5' },
  headerTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  roomTitle: { fontSize: 17, fontWeight: 'bold', color: '#111827' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 12, fontWeight: '600' },
  securityBanner: { marginTop: 8, backgroundColor: '#FFFBEB', borderColor: '#FDE68A', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  securityBannerText: { fontSize: 11, color: '#92400E' },
  listContent: { paddingHorizontal: 16, paddingBottom: 16 },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginVertical: 4 },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#007AFF', borderBottomRightRadius: 4 },
  peerMessage: { alignSelf: 'flex-start', backgroundColor: '#E5E5EA', borderBottomLeftRadius: 4 },
  senderLabel: { fontSize: 11, fontWeight: 'bold', color: '#4B5563', marginBottom: 2 },
  myMessageText: { color: '#ffffff', fontSize: 16 },
  peerMessageText: { color: '#000000', fontSize: 16 },
  timestamp: { fontSize: 10, color: 'rgba(255, 255, 255, 0.7)', alignSelf: 'flex-end', marginTop: 4 },
  peerTimestamp: { color: '#6B7280' },
  inputContainer: { flexDirection: 'row', padding: 12, backgroundColor: '#ffffff', borderTopWidth: 1, borderColor: '#e5e5e5', alignItems: 'center' },
  textInput: { flex: 1, backgroundColor: '#f0f0f0', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, maxHeight: 100, color: '#111111' },
  sendButton: { marginLeft: 12, backgroundColor: '#007AFF', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 20 },
  sendButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
});