import {
  Bitter_500Medium,
  Bitter_600SemiBold,
  Bitter_700Bold,
  useFonts,
} from '@expo-google-fonts/bitter';
import { Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { color } from '@/ui/tokens';

// Hold the native splash until Bitter has resolved, so no screen ever paints
// with a fallback face.
SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden — not worth failing a launch over */
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Bitter_500Medium,
    Bitter_600SemiBold,
    Bitter_700Bold,
  });

  // Landscape only, on every screen, for the whole session.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {
      /* Expo Go on some devices refuses the lock; app.json still pins it */
    });
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.desk }}>
      <SafeAreaProvider>
        <StatusBar hidden />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: color.desk },
          }}
        >
          {/* The boot sheet slides off to the left while these slide in from the right. */}
          <Stack.Screen name="menu" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(onboarding)/name" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
