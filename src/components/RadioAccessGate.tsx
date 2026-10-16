// src/components/RadioAccessGate.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// Props interface defining what this component accepts.
// children represents the main app screens (<AppTabs />) wrapped inside this gate in _layout.tsx
interface RadioAccessGateProps {
  children: React.ReactNode;
}

export default function RadioAccessGate({ children }: RadioAccessGateProps) {
  // useState to track if we have permission to open the main app yet
  const [isGranted, setIsGranted] = useState(false);

  // useState to check if the Android system permission popup is currently open on screen
  const [isChecking, setIsChecking] = useState(true);

  // useCallback keeps this function stable between renders so 'npx expo lint' doesn't give warnings
  // Why required: Calling an async function inside useEffect requires useCallback to avoid infinite re-render loops
  const requestPermissions = useCallback(async () => {
    setIsChecking(true);

    if (Platform.OS === 'android') {
      try {
        /*
         * PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN is just a string. It
         * is a label pointing to the specific Android system permission
         * android.permission.BLUETOOTH_SCAN. It does not ask the user anything by itself.
         *
         * PermissionsAndroid.requestMultiple([...]) is the active function. It takes an
         * array of those permission strings and actually sends the request to the Android OS.
         * // Requesting multiple permissions from the Android OS
         */
        const permissionsToRequest = [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ];

        const granted = await PermissionsAndroid.requestMultiple(permissionsToRequest);

        // Checking if all required permissions were granted
        /*
         * When the user clicks "Allow" or "Deny" on the Android
         * popup, requestMultiple returns a string representing their
         * choice (e.g., "granted", "denied", or "never_ask_again").
         * PermissionsAndroid.RESULTS.GRANTED is simply the official
         * constant for the string "granted". Our code checks if the
         * response we got back matches this constant to ensure the user
         * actually pressed "Allow".
         */
        const allGranted =
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
            PermissionsAndroid.RESULTS.GRANTED;

        if (allGranted) {
          // User tapped Allow -> open the gate and render the app
          setIsGranted(true);
        } else {
          // User tapped Deny -> stay on gate screen so they can retry
          console.warn('Android: Bluetooth permissions denied');
        }
      } catch (err) {
        console.warn('Android Permission Error:', err);
        // Fallback for testing on Expo Go if native popup throws an error
        setIsGranted(true);
      } finally {
        // Done waiting for the popup dialog
        setIsChecking(false);
      }
    } else {
      // iOS automatically prompts for Bluetooth permissions when the BLE manager initializes in the mesh layer.
      setIsGranted(true);
      setIsChecking(false);
    }
  }, []);

  // useEffect to trigger the permission check once when the app loads
  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);

  // State 1 & 2: Still asking for permissions or denied (Show a loading spinner or retry button)
  /*
   * <View>: The fundamental building block for layout in React Native. It is exactly like a
   * <div> in HTML. You use it to group other elements together and style them (like adding padding
   * or centering content).
   *
   * <Text>: Used to display any written text on the screen. It is like a <p> or <span> in HTML.
   * In React Native, you cannot just type raw text inside a <View>; it must be wrapped in a <Text>
   * component, or your app will crash.
   *
   * <ActivityIndicator>: This is React Native's built-in loading spinner. It automatically renders
   * as the standard spinning circle for the platform (a blue/grey spinner on Android, and a grey dashed spinner on iOS).
   */
  if (!isGranted) {
    return (
      <View style={styles.container}>
        {isChecking ? (
          <>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.infoText}>
              Requesting Bluetooth Permissions to connect off-grid...
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.infoText}>
              Bluetooth and Location permissions are needed for off-grid mesh chat.
            </Text>

            {/* Button to ask for permissions again if the user accidentally denied them */}
            <TouchableOpacity style={styles.retryButton} onPress={requestPermissions}>
              <Text style={styles.retryButtonText}>Allow Permissions</Text>
            </TouchableOpacity>

            {/* Bypass button for testing UI in Expo Go without blocking */}
            <TouchableOpacity
              style={styles.skipButton}
              onPress={() => setIsGranted(true)}
            >
              <Text style={styles.skipButtonText}>Continue for testing</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // Once permission is granted, render the main app screens inside children
  return <>{children}</>;
}

// StyleSheet for clean layout and zero lint warnings
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  infoText: {
    marginTop: 14,
    fontSize: 15,
    color: '#333333',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 18,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  skipButton: {
    marginTop: 12,
    padding: 8,
  },
  skipButtonText: {
    color: '#666666',
    fontSize: 13,
  },
});