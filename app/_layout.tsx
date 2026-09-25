import {
  Bitter_500Medium,
  Bitter_600SemiBold,
  Bitter_700Bold,
  useFonts,
} from '@expo-google-fonts/bitter';
import { Fredoka_600SemiBold, Fredoka_700Bold } from '@expo-google-fonts/fredoka';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { PatrickHand_400Regular } from '@expo-google-fonts/patrick-hand';
import { AuthBoundary, PrivyProvider } from '@privy-io/expo';
import { PrivyElements } from '@privy-io/expo/ui';
import { Image } from 'expo-image';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { AppState, BackHandler, Image as RNImage, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initializeAudio, refreshAudioSettings, setAudioActive, setMusic } from '@/audio';
import { AuthErrorScreen, AuthLoadingScreen } from '@/features/auth/AuthStatusScreen';
import { BackendWakeGate } from '@/features/auth/BackendWakeGate';
import { PrivyLoginScreen } from '@/features/auth/PrivyLoginScreen';
import { PrivyProfileSync } from '@/features/auth/PrivyProfileSync';
import { ResumeMatchPrompt } from '@/features/battle/ResumeMatchPrompt';
import { WelcomePointsModal } from '@/features/points/WelcomePointsModal';
import { subscribeConnectivity } from '@/net/connectivity';
import { flushPendingResults } from '@/net/offlineResults';
import { flushPendingWager } from '@/net/offlineWager';
import { useProfile } from '@/state/profile';
import { BACKGROUNDS, BRAND, LOGIN_ART, MENU_ART, type Asset } from '@/ui/assets';
import { ImageBackdrop } from '@/ui/ImageBackdrop';
import { color } from '@/ui/tokens';

// Hold the native splash until the fonts and the first pages' art have
// resolved, so no screen ever paints with a fallback face or a blank page.
SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden — not worth failing a launch over */
});

/** The launch's own pages, warmed in expo-image's cache behind the splash. */
const STARTUP_ART: readonly Asset[] = [
  BACKGROUNDS.splash,
  BACKGROUNDS.logoReveal,
  BACKGROUNDS.identity,
  BACKGROUNDS.login,
  LOGIN_ART.panel,
  BRAND.wordmark,
  MENU_ART.playOnline,
  MENU_ART.playOffline,
];
/**
 * A development build pulls every image from Metro, so the first frame of each
 * startup screen was its plain-grid fallback. Local art in a release build is
 * ready well inside this; it only ever bounds a slow dev server.
 */
const ART_WAIT_MS = 1500;
/** How long the splash and the app wait on the first page painting before going without it. */
const PAGE_WAIT_MS = 600;

function prefetchStartupArt(): Promise<unknown> {
  const uris = STARTUP_ART.flatMap((asset) =>
    typeof asset === 'number' ? [RNImage.resolveAssetSource(asset).uri] : [],
  );
  return Promise.race([
    Image.prefetch(uris, 'memory-disk').catch(() => false),
    new Promise((resolve) => setTimeout(resolve, ART_WAIT_MS)),
  ]);
}

export default function RootLayout() {
  const [artReady, setArtReady] = useState(false);
  const [pageShown, setPageShown] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Bitter_500Medium,
    Bitter_600SemiBold,
    Bitter_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Fredoka_600SemiBold,
    Fredoka_700Bold,
    PatrickHand_400Regular,
  });
  const appId = process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim() ?? '';
  const clientId = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID?.trim() ?? '';

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {
      /* app.json remains the native fallback */
    });
  }, []);

  useEffect(() => {
    void prefetchStartupArt().then(() => setArtReady(true));
  }, []);

  const ready = (fontsLoaded || Boolean(fontError)) && artReady;

  // Nothing is drawn over the first page, and the splash does not lift, until
  // the page has actually painted — so the launch never shows its blank
  // fallback. A page that never paints only delays both briefly.
  useEffect(() => {
    if (!ready || pageShown) return;
    const timer = setTimeout(() => setPageShown(true), PAGE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [ready, pageShown]);

  useEffect(() => {
    if (pageShown) SplashScreen.hideAsync().catch(() => {});
  }, [pageShown]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.paper }}>
      {/*
        The first page, painted once under everything. The sign-in screens and
        the boot are drawn transparently over it, so the hand-offs between them
        (separate trees, each first frame a beat late) never flash the blank
        fallback. Every later route draws its own opaque page over it.
      */}
      <ImageBackdrop source={BACKGROUNDS.splash} onDisplay={() => setPageShown(true)} />
      {pageShown ? (
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
              <PrivyElements
                config={{ appearance: { accentColor: color.ink, colorScheme: 'light' } }}
              />
            </PrivyProvider>
          )}
        </SafeAreaProvider>
      ) : null}
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
        {/* The boot draws transparently over the root's first page. */}
        <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: 'transparent' } }} />
        {/* The boot logo slides off to the left while these slide in from the right. */}
        <Stack.Screen name="menu" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="wallet" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="profile" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="store" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="points" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="(onboarding)/name" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="(onboarding)/progress" options={{ animation: 'slide_from_right' }} />
      </Stack>
      <WelcomePointsModal />
      {/* Finds the player wherever they are when a match outlived the app. */}
      <ResumeMatchPrompt />
      {/* A sibling of the Stack, not a Modal, so its blur has the real screen
          behind it. Holds onboarding and the welcome bonus until the account
          handoff has actually landed. */}
      <BackendWakeGate />
    </>
  );
}
