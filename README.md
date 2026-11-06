# Echo (ChitChatChit) 📡

**Echo** is a decentralized, off-grid messaging app that lets you talk to nearby people **without internet, cellular towers, Wi-Fi, or central servers**. Communicating directly device-to-device using Bluetooth Low Energy (BLE), Echo keeps you connected during blackouts, emergencies, protests, and outdoor adventures.

---

## ✨ Key Features

- **📶 100% Off-Grid & Serverless:** Chat anywhere using pure device-to-device Bluetooth (15–30 meter range per hop). Zero cellular data or internet needed.
- **🔒 Military-Grade Encryption:** All messages are encrypted with **XChaCha20-Poly1305** and stamped with **Ed25519 digital wax seals**. Eavesdroppers only see scrambled static noise.
- **👤 Zero Accounts & Total Anonymity:** No phone numbers, emails, passwords, or SIM cards required. Your cryptographic identity is generated and stored securely on your phone.
- **🔍 Real-Time Peer Discovery:** Automatically detects nearby Echo devices with live signal strength indicators (📶 Strong, Good, Fair, Weak) and friendly display names.
- **💬 Public & Private Rooms:**
  - **Public Room (`#public`):** Open broadcast channel for community chatter and emergency alerts.
  - **Private Channels (`#room`):** Create or join custom topical rooms (e.g., `#study`, `#rescue`).
  - **Direct Messages:** Secure 1-on-1 private messaging with any discovered peer.
- **🛡️ Anti-Tracking Privacy:** Automatically rotates Bluetooth advertising tags to prevent strangers or surveillance cameras from tracking your physical location.

---

## 🚀 Quick Start & Build Commands

### 1. Prerequisites
- **Node.js** (v18+)
- **Android Studio** & **Android SDK** (with Build Tools & NDK)
- **Java JDK 17**

---

### 2. Install Dependencies
```bash
npm install
```

---

### 3. Run Automated Tests
Verify all cryptographic math, chunking, and protocol pipelines:
```bash
npx vitest run
```

---

### 4. Start Development Server
```bash
npx expo start
```

---

### 5. Build Android Release APK
To compile the standalone release APK:
```bash
cd android
./gradlew assembleRelease
cd ..
```

The compiled APK will be located at:
```text
android/app/build/outputs/apk/release/app-release.apk
```

---

### 6. Install on Connected Android Device
Make sure **USB Debugging** is turned on, connect your phone, and run:
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```
*(Or copy it as `Echo.apk` and run `adb install -r Echo.apk`)*

---

## 📱 System Requirements
- **Android:** Android 8.0 (Oreo / API 26) through Android 13+ (API 33+) with Bluetooth LE enabled.
- **Permissions:** Bluetooth & Nearby Devices permissions are requested on first launch.
