// src/app/discover.tsx
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DiscoveredPeer, MeshService, RadioStatus } from '../lib/MeshService';
import { getDisplayName, saveDisplayName, getSavedRooms, saveRoom } from '../lib/store';

// CHANGED (AI Issue 11): Helper function to translate raw dBm into visual signal bars
const getSignalBars = (rssi: number) => {
  if (rssi >= -60) return '📶 Strong';
  if (rssi >= -75) return '📶 Good';
  if (rssi >= -90) return '📶 Fair';
  return '📶 Weak';
};

export default function DiscoverScreen() {
  const router = useRouter();

  const [radioState, setRadioState] = useState<RadioStatus>('scanning');
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  const [isPulsing, setIsPulsing] = useState(false);
  const [nodeId, setNodeId] = useState<string>('Initializing...');
  
  const [displayName, setDisplayName] = useState('Anonymous');
  const [editName, setEditName] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const [savedRooms, setSavedRooms] = useState<string[]>([]);
  const [newRoomName, setNewRoomName] = useState('');

  const syncMeshState = useCallback(() => {
    setRadioState(MeshService.getRadioStatus());
    setPeers(MeshService.getDiscoveredPeers());
    setNodeId(MeshService.getMyNodeId());
  }, []);

  useEffect(() => {
    getDisplayName().then((name) => {
      setDisplayName(name);
      setEditName(name);
    });

    getSavedRooms().then(setSavedRooms);

    MeshService.initialize().then(() => {
      syncMeshState();
    });

    const unsubscribe = MeshService.subscribe(() => {
      syncMeshState();
    });

    const interval = setInterval(syncMeshState, 2000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [syncMeshState]);

  const handleManualScan = () => {
    setIsPulsing(true);
    MeshService.pulseScanner();
    syncMeshState();
    setTimeout(() => setIsPulsing(false), 1200);
  };

  const openChatWithPeer = (peerId: string) => {
    router.push({ pathname: '/chat' as any, params: { peer: peerId } });
  };

  const handleJoinRoom = async () => {
    const clean = newRoomName.trim().toLowerCase().replace(/^#+/, '');
    if (!clean) return;
    await saveRoom(clean);
    setSavedRooms((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
    setNewRoomName('');
    router.push({ pathname: '/chat' as any, params: { peer: clean } });
  };

  const handleSaveName = async () => {
    if (editName.trim()) {
      await saveDisplayName(editName);
      setDisplayName(editName.trim());
    }
    setIsEditing(false);
  };

  const getStatusBanner = () => {
    // Dark-themed status cards with subtle borders
    if (radioState === 'off') {
      return {
        icon: '🔴',
        title: 'Offline',
        subtitle: 'Bluetooth or Location is turned off.',
        bg: '#2A1215',
        border: '#4C1D24',
        textColor: '#F87171',
      };
    }
    if (radioState === 'connecting') {
      return {
        icon: '🟡',
        title: 'Connecting',
        subtitle: 'Linking to nearby phones...',
        bg: '#2D1F08',
        border: '#54380E',
        textColor: '#FBBF24',
      };
    }
    return {
      icon: '🟢',
      title: 'Active',
      subtitle: 'Looking for nearby phones...',
      bg: '#062817',
      border: '#0B4D2C',
      textColor: '#4ADE80',
    };
  };

  const banner = getStatusBanner();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.headerRow}>
          <Text style={styles.screenTitle}>Discover</Text>
        </View>

        {/* 1. LIVE RADIO STATUS BANNER */}
        <View
          style={[
            styles.statusCard,
            { backgroundColor: banner.bg, borderColor: banner.border },
          ]}
        >
          <View style={styles.statusHeaderRow}>
            <Text style={styles.statusEmoji}>{banner.icon}</Text>
            <View style={styles.statusTextColumn}>
              <Text style={[styles.statusTitle, { color: banner.textColor }]}>
                {banner.title}
              </Text>
              <Text style={[styles.statusSubtitle, { color: banner.textColor }]}>
                {banner.subtitle}
              </Text>
            </View>
          </View>
        </View>

        {/* 2. MY PROFILE CARD */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>My Profile</Text>
          {isEditing ? (
            <View style={styles.editNameRow}>
              <TextInput
                style={styles.nameInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Enter display name"
                maxLength={20}
                autoFocus={true}
              />
              <TouchableOpacity style={styles.primaryActionBtn} onPress={handleSaveName}>
                <Text style={styles.primaryActionBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.identityRow}>
              <View style={styles.idBadge}>
                <Text style={styles.idBadgeText}>{displayName}</Text>
              </View>
              <TouchableOpacity style={styles.secondaryActionBtn} onPress={() => setIsEditing(true)}>
                <Text style={styles.secondaryActionBtnText}>Edit Name</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* CHANGED (AI Issue 12): Node ID was removed from here to reduce clutter */}
        </View>

        {/* 3. NEARBY DEVICES */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.cardSectionTitle}>Nearby Devices</Text>
            <Text style={styles.peerCounterText}>{peers.length} in range</Text>
          </View>

          {peers.length === 0 ? (
            <View style={styles.emptyStateBox}>
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text style={styles.emptyStateText}>
                No devices in range. Keep phones within 15–30 meters.
              </Text>
            </View>
          ) : (
            peers.map((peer) => (
              <View key={peer.peerId} style={styles.peerRow}>
                <View style={styles.peerInfo}>
                  <Text style={styles.peerTagText}>{peer.tag}</Text>
                  <Text style={styles.peerStatusText}>
                    {peer.status}
                    {/* CHANGED (AI Issue 11): Renders "📶 Strong" instead of raw numbers */}
                    {typeof peer.rssi === 'number' ? `\n${getSignalBars(peer.rssi)}` : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.messagePeerBtn}
                  onPress={() => openChatWithPeer(peer.peerId)}
                >
                  <Text style={styles.messagePeerBtnText}>Message</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* 4. ROOMS (PUBLIC & PRIVATE) */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Rooms</Text>

          {/* Public Room */}
          <TouchableOpacity
            style={styles.channelRow}
            onPress={() => openChatWithPeer('global_mesh_room')}
          >
            <View style={styles.channelInfo}>
              <Text style={styles.channelName}>Public Room</Text>
            </View>
            <View style={styles.openChannelBadge}>
              <Text style={styles.openChannelBadgeText}>Chat</Text>
            </View>
          </TouchableOpacity>

          {/* Saved Private Rooms */}
          {savedRooms.map((room) => (
            <TouchableOpacity
              key={room}
              style={styles.channelRow}
              onPress={() => openChatWithPeer(room)}
            >
              <View style={styles.channelInfo}>
                <Text style={styles.channelName}>#{room}</Text>
              </View>
              <View style={styles.openChannelBadge}>
                <Text style={styles.openChannelBadgeText}>Chat</Text>
              </View>
            </TouchableOpacity>
          ))}

          {/* Create or Join Private Room */}
          <View style={styles.joinRoomRow}>
            <TextInput
              style={styles.roomInput}
              placeholder="Private room name"
              placeholderTextColor="#9CA3AF"
              value={newRoomName}
              onChangeText={setNewRoomName}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.joinRoomBtn} onPress={handleJoinRoom}>
              <Text style={styles.joinRoomBtnText}>Join</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      {/* 5. FLOATING SCAN BUTTON (AI Issue 9: Ensured this is the single unified scan button) */}
      <TouchableOpacity
        style={styles.fabScanButton}
        onPress={handleManualScan}
        activeOpacity={0.85}
      >
        <Text style={styles.fabScanButtonText}>
          {isPulsing ? 'Scanning...' : '📡 Refresh / Scan'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0B0C10' },
  scrollView: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 100, gap: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  screenTitle: { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF' },
  statusCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  statusHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusEmoji: { fontSize: 22 },
  statusTextColumn: { flex: 1 },
  statusTitle: { fontSize: 16, fontWeight: 'bold' },
  statusSubtitle: { fontSize: 13, marginTop: 2 },
  card: { backgroundColor: '#13141B', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#22232E', gap: 12 },
  cardSectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#F4F4F5' },
  identityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: { flex: 1, backgroundColor: '#1C1D26', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, borderWidth: 1, borderColor: '#2E303E', color: '#FFFFFF' },
  idBadge: { backgroundColor: '#1C1D26', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#2E303E' },
  idBadgeText: { fontSize: 15, fontWeight: 'bold', color: '#FFFFFF' },
  primaryActionBtn: { backgroundColor: '#7C3AED', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  primaryActionBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  secondaryActionBtn: { backgroundColor: '#2E1065', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#4C1D95' },
  secondaryActionBtnText: { color: '#C084FC', fontWeight: '600', fontSize: 13 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  peerCounterText: { fontSize: 12, fontWeight: '600', color: '#9CA3AF' },
  emptyStateBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, paddingHorizontal: 16, gap: 12 },
  emptyStateText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 19 },
  peerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#22232E' },
  peerInfo: { flex: 1 },
  peerTagText: { fontSize: 15, fontWeight: 'bold', color: '#FFFFFF' },
  peerStatusText: { fontSize: 12, color: '#34D399', marginTop: 2 },
  messagePeerBtn: { backgroundColor: '#7C3AED', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  messagePeerBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  channelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1C1D26', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#2E303E' },
  channelInfo: { flex: 1, paddingRight: 8 },
  channelName: { fontSize: 15, fontWeight: 'bold', color: '#FFFFFF' },
  openChannelBadge: { backgroundColor: '#7C3AED', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  openChannelBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: 'bold' },
  joinRoomRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  roomInput: { flex: 1, backgroundColor: '#1C1D26', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, borderWidth: 1, borderColor: '#2E303E', color: '#FFFFFF' },
  joinRoomBtn: { backgroundColor: '#7C3AED', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  joinRoomBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  fabScanButton: { position: 'absolute', right: 20, bottom: 24, backgroundColor: '#7C3AED', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 28, elevation: 4, shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6 },
  fabScanButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },
});