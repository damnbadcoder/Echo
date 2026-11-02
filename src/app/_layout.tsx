if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {};
}
if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = function <T extends ArrayBufferView | null>(array: T): T {
    if (!array) return array;
    const uint8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < uint8.length; i++) {
      const r = (Math.random() * 0x100000000) ^ (Date.now() & 0xffffffff);
      uint8[i] = (r >> ((i % 4) * 8)) & 0xff;
    }
    return array;
  };
}

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
// 1. Import the new permission gate component
import RadioAccessGate from '../components/RadioAccessGate';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* 2. Wrap the gate around your app's main visual components */}
      <RadioAccessGate>
        <AnimatedSplashOverlay />
        <AppTabs />
      </RadioAccessGate>
    </ThemeProvider>
  );
}