import {
  Bitter_500Medium,
  Bitter_600SemiBold,
  Bitter_700Bold,
  useFonts,
} from '@expo-google-fonts/bitter';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { AuthBoundary, PrivyProvider } from '@privy-io/expo';
import { PrivyElements } from '@privy-io/expo/ui';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, BackHandler, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initializeAudio, refreshAudioSettings, setAudioActive, setMusic } from '@/audio';
import { AuthErrorScreen, AuthLoadingScreen } from '@/features/auth/AuthStatusScreen';
import { PrivyLoginScreen } from '@/features/auth/PrivyLoginScreen';
import { PrivyProfileSync } from '@/features/auth/PrivyProfileSync';
import { WelcomePointsModal } from '@/features/points/WelcomePointsModal';
import { subscribeConnectivity } from '@/net/connectivity';
import { flushPendingResults } from '@/net/offlineResults';
import { flushPendingWager } from '@/net/offlineWager';
import { useProfile } from '@/state/profile';
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
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const appId = process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim() ?? '';
  const clientId = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID?.trim() ?? '';

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {
      /* app.json remains the native fallback */
    });
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.paper }}>
      <SafeAreaProvider>
        <StatusBar hidden />
        {!appId || !clientId ? (
          <AuthErrorScreen
            title="Privy setup needed"
            message="Set EXPO_PUBLIC_PRIVY_APP_ID and EXPO_PUBLIC_PRIVY_CLIENT_ID, then rebuild the development app."
          />
        ) : (
          <PrivyProvider
            appId={appId}
            clientId={clientId}
            config={{ embedded: { solana: { createOnLogin: 'users-without-wallets' } } }}
          >
            <AuthBoundary
              loading={<AuthLoadingScreen />}
              unauthenticated={<PrivyLoginScreen />}
              error={(error) => (
                <AuthErrorScreen title="Sign-in unavailable" message={error.message} />
              )}
            >
              <AuthenticatedApp />
            </AuthBoundary>
            <PrivyElements config={{ appearance: { accentColor: color.ink, colorScheme: 'light' } }} />
          </PrivyProvider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AuthenticatedApp() {
  const pathname = usePathname();
  const router = useRouter();

  // Allocate and preload the complete audio pool during boot. Route changes
  // only switch already-loaded loops; no gameplay path constructs a player.
  useEffect(() => {
    void initializeAudio();
    return useProfile.subscribe((state, previous) => {
      if (
        state.soundOn !== previous.soundOn ||
        state.musicOn !== previous.musicOn ||
        state.soundVolume !== previous.soundVolume ||
        state.musicVolume !== previous.musicVolume
      ) {
        refreshAudioSettings();
      }
    });
  }, []);

  useEffect(() => {
    const inBattle = pathname.includes('/battle') || pathname === '/tutorial';
    setMusic(inBattle ? 'battle' : 'menu');
  }, [pathname]);

  // Explicit fallback for every route. Battle/tutorial and placement own
  // richer back behavior, so returning false lets their focused handler run.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (
        pathname.includes('battle') ||
        pathname === '/tutorial' ||
        pathname.includes('placement')
      ) {
        return false;
      }
      if (pathname === '/' || pathname === '/menu') return true;
      if (pathname.includes('result')) router.replace('/menu');
      else if (router.canGoBack()) router.back();
      else router.replace('/menu');
      return true;
    });
    return () => subscription.remove();
  }, [pathname, router]);

  // Results are local-first. Foregrounding, or regaining a connection while
  // foregrounded, retries the persisted queue without blocking navigation.
  useEffect(() => {
    const flushIfActive = () => {
      if (AppState.currentState !== 'active') return;
      void flushPendingResults();
      // A won offline stake must still be paid out after a crash or a kill.
      void flushPendingWager();
    };
    flushIfActive();
    const appState = AppState.addEventListener('change', (state) => {
      const isActive = state === 'active';
      setAudioActive(isActive);
      if (isActive) flushIfActive();
    });
    const connectivity = subscribeConnectivity((online) => {
      if (online) flushIfActive();
    });
    return () => {
      appState.remove();
      connectivity();
    };
  }, []);

  return (
    <>
      <PrivyProfileSync />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: color.paper },
        }}
      >
        {/* The boot sheet slides off to the left while these slide in from the right. */}
        <Stack.Screen name="menu" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="wallet" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="profile" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="points" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="(onboarding)/name" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="(onboarding)/progress" options={{ animation: 'slide_from_right' }} />
      </Stack>
      <WelcomePointsModal />
    </>
  );
}
