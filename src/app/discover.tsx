// src/app/discover.tsx
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DiscoveredPeer, MeshService, RadioStatus } from "../lib/MeshService";

export default function DiscoverScreen() {
  const router = useRouter();

  const [radioState, setRadioState] = useState<RadioStatus>("scanning");
  const [nodeId, setNodeId] = useState<string>("Initializing...");
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  const [copied, setCopied] = useState(false);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);

  // Custom Channel States
  const [channelName, setChannelName] = useState("");
  const [savedChannels, setSavedChannels] = useState<string[]>([]);

  const syncMeshState = useCallback(() => {
    setRadioState(MeshService.getRadioStatus());
    setNodeId(MeshService.getMyNodeId());
    setPeers(MeshService.getDiscoveredPeers());
  }, []);

  useEffect(() => {
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

  const truncatedId =
    nodeId.length > 12 ? `${nodeId.slice(0, 4)}...${nodeId.slice(-4)}` : nodeId;

  const handleCopyId = async () => {
    try {
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.clipboard
      ) {
        await navigator.clipboard.writeText(nodeId);
      } else {
        await Share.share({ message: nodeId, title: "My Echo Node ID" });
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert("My Node ID", nodeId);
    }
  };

  const handleManualScan = () => {
    setIsPulsing(true);
    MeshService.pulseScanner();
    syncMeshState();
    setTimeout(() => setIsPulsing(false), 1200);
  };

  const openChatWithPeer = (peerId: string) => {
    router.push({ pathname: "/", params: { peer: peerId } });
  };

  const handleJoinCustomChannel = () => {
    if (channelName.trim().length > 0) {
      const newChannel = channelName.trim();

      if (!savedChannels.includes(newChannel)) {
        setSavedChannels((prev) => [...prev, newChannel]);
      }

      router.push({ pathname: "/", params: { peer: newChannel } });
      setChannelName("");
    }
  };

  const getStatusBanner = () => {
    if (radioState === "off") {
      return {
        icon: "🔴",
        title: "Radio Off",
        subtitle: "Bluetooth or Location is disabled",
        bg: "#FEF2F2",
        border: "#FECACA",
        textColor: "#991B1B",
      };
    }
    if (radioState === "connecting") {
      return {
        icon: "🟡",
        title: "Connecting",
        subtitle: "Handshake in progress...",
        bg: "#FEFCE8",
        border: "#FEF08A",
        textColor: "#854D0E",
      };
    }
    return {
      icon: "🟢",
      title: "Active / Scanning",
      subtitle: "Listening for nearby Echo devices...",
      bg: "#F0FDF4",
      border: "#BBF7D0",
      textColor: "#166534",
    };
  };

  const banner = getStatusBanner();

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.headerRow}>
          <Text style={styles.screenTitle}>Discover</Text>
          <TouchableOpacity
            style={styles.topScanButton}
            onPress={handleManualScan}
            disabled={isPulsing}
          >
            <Text style={styles.topScanButtonText}>
              {isPulsing ? "Scanning..." : "Refresh / Scan"}
            </Text>
          </TouchableOpacity>
        </View>

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
              <Text
                style={[styles.statusSubtitle, { color: banner.textColor }]}
              >
                {banner.subtitle}
              </Text>
            </View>
          </View>
          <View style={styles.helperNoticeBox}>
            <Text style={styles.helperNoticeText}>
              ⚠️ "Off-Grid BLE Mesh requires both Bluetooth and phone Location
              (GPS) toggles turned ON in Android Quick Settings."
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>My Node ID</Text>
          <View style={styles.identityRow}>
            <View style={styles.idBadge}>
              <Text style={styles.idBadgeText}>{truncatedId}</Text>
            </View>
            <View style={styles.identityActions}>
              <TouchableOpacity
                style={styles.primaryActionBtn}
                onPress={handleCopyId}
              >
                <Text style={styles.primaryActionBtnText}>
                  {copied ? "Copied!" : "Copy ID"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryActionBtn}
                onPress={() => setQrModalVisible(true)}
              >
                <Text style={styles.secondaryActionBtnText}>Show QR Code</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.cardSectionTitle}>Nearby Mesh Peers</Text>
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
                    {typeof peer.rssi === "number" ? ` • ${peer.rssi} dBm` : ""}
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

        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>
            Channels & Broadcast Rooms
          </Text>

          <TouchableOpacity
            style={styles.channelRow}
            onPress={() => openChatWithPeer("global_mesh_room")}
          >
            <View style={styles.channelInfo}>
              <Text style={styles.channelName}>#global_mesh_room</Text>
              <Text style={styles.channelDesc}>
                Walkie-Talkie Mode — default public mesh room
              </Text>
              <Text style={styles.channelStatus}>🟢 Active • Public</Text>
            </View>
            <View style={styles.openChannelBadge}>
              <Text style={styles.openChannelBadgeText}>Chat</Text>
            </View>
          </TouchableOpacity>

          {/* Render saved channels */}
          {savedChannels.map((channel) => (
            <TouchableOpacity
              key={channel}
              style={[styles.channelRow, { marginTop: 8 }]}
              onPress={() => openChatWithPeer(channel)}
            >
              <View style={styles.channelInfo}>
                <Text style={styles.channelName}>#{channel}</Text>
                <Text style={styles.channelDesc}>
                  Custom secure broadcast channel
                </Text>
                <Text style={styles.channelStatus}>🔒 Active • Private</Text>
              </View>
              <View style={styles.openChannelBadge}>
                <Text style={styles.openChannelBadgeText}>Chat</Text>
              </View>
            </TouchableOpacity>
          ))}

          <View style={styles.customChannelWrapper}>
            <Text style={styles.cardSectionTitle}>Join Custom Channel</Text>
            <Text style={styles.channelDesc}>
              Enter a shared secret name to connect securely.
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.channelInput}
                placeholder="e.g. project_echo"
                placeholderTextColor="#9CA3AF"
                value={channelName}
                onChangeText={setChannelName}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.joinButton}
                onPress={handleJoinCustomChannel}
              >
                <Text style={styles.joinButtonText}>Join</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={styles.fabScanButton}
        onPress={handleManualScan}
        activeOpacity={0.85}
      >
        <Text style={styles.fabScanButtonText}>
          {isPulsing ? "Scanning..." : "📡 Refresh / Scan"}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={qrModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setQrModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>My Node Public Identity</Text>
            <View style={styles.qrPlaceholder}>
              <Text style={styles.qrPlaceholderIcon}>[ QR ]</Text>
              <Text style={styles.qrPlaceholderText}>{truncatedId}</Text>
            </View>
            <Text style={styles.fullNodeIdText} selectable={true}>
              {nodeId}
            </Text>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setQrModalVisible(false)}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 100,
    gap: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
  },
  topScanButton: {
    backgroundColor: "#E5E7EB",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  topScanButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1F2937",
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  statusHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusEmoji: {
    fontSize: 22,
  },
  statusTextColumn: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: "bold",
  },
  statusSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  helperNoticeBox: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  helperNoticeText: {
    fontSize: 12,
    color: "#92400E",
    lineHeight: 17,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 12,
  },
  cardSectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#111827",
  },
  identityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  idBadge: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  idBadgeText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 15,
    fontWeight: "bold",
    color: "#1F2937",
  },
  identityActions: {
    flexDirection: "row",
    gap: 8,
  },
  primaryActionBtn: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  primaryActionBtnText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 13,
  },
  secondaryActionBtn: {
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  secondaryActionBtnText: {
    color: "#1D4ED8",
    fontWeight: "600",
    fontSize: 13,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  peerCounterText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6B7280",
  },
  emptyStateBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 12,
  },
  emptyStateText: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 19,
  },
  peerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  peerInfo: {
    flex: 1,
  },
  peerTagText: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#111827",
  },
  peerStatusText: {
    fontSize: 12,
    color: "#059669",
    marginTop: 2,
  },
  messagePeerBtn: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  messagePeerBtnText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 13,
  },
  channelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  channelInfo: {
    flex: 1,
    paddingRight: 8,
  },
  channelName: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#111827",
  },
  channelDesc: {
    fontSize: 12,
    color: "#4B5563",
    marginTop: 2,
  },
  channelStatus: {
    fontSize: 12,
    fontWeight: "600",
    color: "#15803D",
    marginTop: 4,
  },
  openChannelBadge: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  openChannelBadgeText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "bold",
  },
  customChannelWrapper: {
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    gap: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  channelInput: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 15,
    color: "#111827",
  },
  joinButton: {
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    borderRadius: 8,
    height: 44,
  },
  joinButtonText: {
    color: "#FFFFFF",
    fontWeight: "bold",
    fontSize: 15,
  },
  fabScanButton: {
    position: "absolute",
    right: 20,
    bottom: 24,
    backgroundColor: "#007AFF",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 28,
    elevation: 4,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabScanButtonText: {
    color: "#FFFFFF",
    fontWeight: "bold",
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#111827",
  },
  qrPlaceholder: {
    width: 180,
    height: 180,
    borderWidth: 2,
    borderColor: "#111827",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    gap: 8,
  },
  qrPlaceholderIcon: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#111827",
  },
  qrPlaceholderText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4B5563",
  },
  fullNodeIdText: {
    fontSize: 11,
    color: "#6B7280",
    textAlign: "center",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  modalCloseBtn: {
    backgroundColor: "#111827",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
  },
  modalCloseBtnText: {
    color: "#FFFFFF",
    fontWeight: "bold",
    fontSize: 14,
  },
});
