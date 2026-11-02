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
import { getDisplayName, saveDisplayName } from '../lib/store';

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
    router.push({ pathname: '/', params: { peer: peerId } });
  };

  const handleSaveName = async () => {
    if (editName.trim()) {
      await saveDisplayName(editName);
      setDisplayName(editName.trim());
    }
    setIsEditing(false);
  };

  const getStatusBanner = () => {
    // CHANGED (User Issue 7 & AI Issue 10): Eradicated technical jargon from radio statuses
    if (radioState === 'off') {
      return {
        icon: '🔴',
        title: 'Offline',
        subtitle: 'Bluetooth or Location is turned off.',
        bg: '#FEF2F2',
        border: '#FECACA',
        textColor: '#991B1B',
      };
    }
    if (radioState === 'connecting') {
      return {
        icon: '🟡',
        title: 'Connecting',
        subtitle: 'Linking to nearby phones...',
        bg: '#FEFCE8',
        border: '#FEF08A',
        textColor: '#854D0E',
      };
    }
    return {
      icon: '🟢',
      title: 'Active',
      subtitle: 'Looking for nearby phones...',
      bg: '#F0FDF4',
      border: '#BBF7D0',
      textColor: '#166534',
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
          <View style={styles.helperNoticeBox}>
            <Text style={styles.helperNoticeText}>
              ⚠️ Offline Chat requires both Bluetooth and Location turned ON in your phone settings.
            </Text>
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
              <ActivityIndicator size="large" color="#007AFF" />
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
              </View>
            ))
          )}
        </View>

        {/* 4. PUBLIC BROADCAST ROOM */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Public Rooms</Text>

          <TouchableOpacity
            style={styles.channelRow}
            onPress={() => openChatWithPeer('global_mesh_room')}
          >
            <View style={styles.channelInfo}>
              {/* CHANGED (User Issue 7): Eradicated `#global_mesh_room` jargon from the UI */}
              <Text style={styles.channelName}>Public Room</Text>
              <Text style={styles.channelDesc}>
                Chat with everyone nearby at once
              </Text>
              <Text style={styles.channelStatus}>🟢 Active • Public</Text>
            </View>
            <View style={styles.openChannelBadge}>
              <Text style={styles.openChannelBadgeText}>Chat</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* CHANGED (AI Issue 12): Moved the long Node ID to an advanced footer out of the main cards */}
        <View style={styles.advancedContainer}>
          <Text style={styles.advancedLabel}>Advanced Details</Text>
          <Text style={styles.nodeIdHint}>Hardware ID: {nodeId}</Text>
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
  safeArea: { flex: 1, backgroundColor: '#F3F4F6' },
  scrollView: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 100, gap: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  screenTitle: { fontSize: 24, fontWeight: 'bold', color: '#111827' },
  statusCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  statusHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusEmoji: { fontSize: 22 },
  statusTextColumn: { flex: 1 },
  statusTitle: { fontSize: 16, fontWeight: 'bold' },
  statusSubtitle: { fontSize: 13, marginTop: 2 },
  helperNoticeBox: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A', borderWidth: 1, borderRadius: 10, padding: 10 },
  helperNoticeText: { fontSize: 12, color: '#92400E', lineHeight: 17 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#E5E7EB', gap: 12 },
  cardSectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
  identityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, borderWidth: 1, borderColor: '#D1D5DB' },
  idBadge: { backgroundColor: '#F3F4F6', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB' },
  idBadgeText: { fontSize: 15, fontWeight: 'bold', color: '#1F2937' },
  primaryActionBtn: { backgroundColor: '#007AFF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  primaryActionBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  secondaryActionBtn: { backgroundColor: '#EFF6FF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE' },
  secondaryActionBtnText: { color: '#1D4ED8', fontWeight: '600', fontSize: 13 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  peerCounterText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  emptyStateBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, paddingHorizontal: 16, gap: 12 },
  emptyStateText: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 19 },
  peerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  peerInfo: { flex: 1 },
  peerTagText: { fontSize: 15, fontWeight: 'bold', color: '#111827' },
  peerStatusText: { fontSize: 12, color: '#059669', marginTop: 2 },
  channelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F9FAFB', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  channelInfo: { flex: 1, paddingRight: 8 },
  channelName: { fontSize: 15, fontWeight: 'bold', color: '#111827' },
  channelDesc: { fontSize: 12, color: '#4B5563', marginTop: 2 },
  channelStatus: { fontSize: 12, fontWeight: '600', color: '#15803D', marginTop: 4 },
  openChannelBadge: { backgroundColor: '#007AFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  openChannelBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: 'bold' },
  fabScanButton: { position: 'absolute', right: 20, bottom: 24, backgroundColor: '#007AFF', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 28, elevation: 4, shadowColor: '#000000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
  fabScanButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },
  advancedContainer: { marginTop: 8, paddingHorizontal: 4, alignItems: 'center' },
  advancedLabel: { fontSize: 12, fontWeight: 'bold', color: '#9CA3AF', marginBottom: 4 },
  nodeIdHint: { fontSize: 11, color: '#9CA3AF', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', textAlign: 'center' },
});