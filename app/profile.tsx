/**
 * Captain's profile — drawn to its mockup on BACKGROUNDS.settings: the captain
 * (the portrait they chose, in their colour, inside the rope ring, their flag
 * pinned to it) with their standing and their store collection on the left;
 * the verified Privy account on the right. The flag row opens the flag
 * picker, the collection strip the whole collection. Sign-out asks first, and
 * says so plainly if it cannot finish.
 */
import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type ImageStyle } from 'react-native';

import { ArtButton } from '@/features/auth/LoginArt';
import { privyDisplayName, privyEmail, privyLoginMethods } from '@/features/auth/privyUser';
import { countryName } from '@/features/flags/countries';
import { FlagBadge } from '@/features/flags/FlagBadge';
import { FlagPicker } from '@/features/flags/FlagPicker';
import { CollectionDialog, CollectionStrip } from '@/features/store/Collection';
import { signOutGameplaySession } from '@/net/api';
import { useMatchClient } from '@/net/match-client';
import { pushProfile } from '@/net/profileSync';
import { useBattle } from '@/state/battle';
import { useCloud } from '@/state/cloud';
import { spendableCoins, useStoreWallet } from '@/state/locker';
import { useProfile } from '@/state/profile';
import { usePoints } from '@/state/points';
import { usePrivySync } from '@/state/privySync';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { BACKGROUNDS, LOGIN_ART, PROFILE_ART, SETTINGS_ART, type Asset } from '@/ui/assets';
import { InkSpinner } from '@/ui/InkSpinner';
import { portraitFor } from '@/ui/portraits';
import { Scale } from '@/ui/Scale';
import { VSlicedImage } from '@/ui/SlicedImage';
import { CANVAS_H, CANVAS_W, artColor, color, font } from '@/ui/tokens';
import { shortAddress } from '@/wallet/solana';

const LEFT = { x: 20, y: 66, w: 378, h: 282 } as const;
const RIGHT = { x: 410, y: 66, w: 372, h: 282 } as const;
/** round-frame.png is 234 x 231; its hole is radius 103 about (117, 115). */
const RING = { w: 84, h: 84 * (231 / 234) } as const;
const HOLE = { cx: 117 / 234, cy: 115 / 231, r: 104 / 234 } as const;
const DIALOG = { w: 420, h: 236 } as const;

function Art({ source, style }: { source: Asset; style: ImageStyle }) {
  return (
    <Image
      source={source}
      style={[{ position: 'absolute' }, style]}
      contentFit="contain"
      cachePolicy="memory-disk"
      pointerEvents="none"
    />
  );
}

/**
 * The chosen captain inside the rope ring. The portrait is the square picker
 * art with its own frame and mat cropped off, clipped to the ring's hole.
 */
function RingPortrait({
  avatarId,
  avatarColor,
  countryCode,
}: {
  avatarId: number;
  avatarColor: string;
  countryCode: string;
}) {
  const d = HOLE.r * 2 * RING.w;
  // The portrait art's picture starts ~11% in from each edge (its frame + mat).
  const size = d / 0.78;
  return (
    <View style={{ width: RING.w, height: RING.h }}>
      <View
        style={{
          position: 'absolute',
          left: HOLE.cx * RING.w - d / 2,
          top: HOLE.cy * RING.h - d / 2,
          width: d,
          height: d,
          borderRadius: d / 2,
          overflow: 'hidden',
        }}
      >
        <Image
          source={portraitFor(avatarId, avatarColor)}
          style={{ position: 'absolute', left: (d - size) / 2, top: (d - size) / 2 + 2, width: size, height: size }}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
      </View>
      <Image source={PROFILE_ART.ringFrame} style={StyleSheet.absoluteFill} contentFit="fill" />
      <FlagBadge code={countryCode} w={34} style={styles.ringFlag} />
    </View>
  );
}

function Detail({
  label,
  value,
  danger = false,
  last = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, danger ? styles.danger : null]} numberOfLines={1} selectable>
        {value}
      </Text>
      {last ? null : (
        <Image source={SETTINGS_ART.dashedDivider} style={styles.detailRule} contentFit="fill" />
      )}
    </View>
  );
}

function clearSignedInState(): void {
  useMatchClient.getState().disconnect();
  useBattle.getState().reset();
  useCloud.getState().setProfile(null);
  usePrivySync.getState().clear();
  usePoints.getState().clear();
  useProfile.getState().clearAccount();
}

function SignOutDialog({
  visible,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (!busy) onCancel();
      }}
    >
      <View style={styles.dialogDim} accessibilityViewIsModal>
        <Scale transparent>
          <View style={styles.dialogCard}>
            <VSlicedImage
              slices={PROFILE_ART.accountPanel}
              w={DIALOG.w}
              h={DIALOG.h}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.dialogBodyBox}>
              <Text style={styles.dialogKicker}>Leave the ship?</Text>
              <Text style={styles.dialogTitle}>Sign out of this captain</Text>
              <Text style={styles.dialogBody}>
                This device will forget this account, its wallet session, and cached game details.
                Your server progress stays safe for your next sign-in.
              </Text>
              {error ? <Text style={styles.dialogError}>{error}</Text> : null}
              <View style={styles.dialogActions}>
                <ArtButton
                  slices={SETTINGS_ART.creamButton}
                  w={146}
                  h={40}
                  label="Stay signed in"
                  fontSize={15}
                  disabled={busy}
                  onPress={onCancel}
                />
                <ArtImageButton
                  source={PROFILE_ART.signOut}
                  w={132}
                  h={41}
                  label={busy ? 'Signing out' : 'Sign out'}
                  disabled={busy}
                  onPress={onConfirm}
                />
              </View>
            </View>
            {busy ? <InkSpinner size={18} seedKey="profile-signing-out" style={styles.dialogSpinner} /> : null}
          </View>
        </Scale>
      </View>
    </Modal>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const profile = useProfile();
  const { user, logout } = usePrivy();
  const walletState = useEmbeddedSolanaWallet();
  const sync = usePrivySync();
  const pointBalance = usePoints((state) => state.balance);
  const [loggingOut, setLoggingOut] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const wallet = useStoreWallet();
  const coins = spendableCoins(profile.coins, wallet);
  const email = privyEmail(user) ?? sync.account?.email ?? 'Not available';
  const displayName = privyDisplayName(user) ?? sync.account?.displayName ?? '—';
  const methods = privyLoginMethods(user);
  const walletAddress = walletState.wallets?.[0]?.address ?? sync.account?.solanaWalletAddress ?? '';
  const created = useMemo(
    () => (user ? new Date(user.created_at * 1000).toLocaleDateString() : '—'),
    [user],
  );

  const confirmLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setSignOutError(null);
    useMatchClient.getState().disconnect();
    const gameplaySignOut = signOutGameplaySession();
    try {
      await logout();
      clearSignedInState();
      // Park the router on boot so the next sign-in runs the handoff before any
      // screen reads the profile — otherwise a second account can land on a
      // route still showing the account that just left.
      router.replace('/');
      const gameplay = await gameplaySignOut;
      if (!gameplay.ok) {
        console.warn(
          '[auth] gameplay session was cleared locally but remote revocation failed:',
          gameplay.error.message,
        );
      }
    } catch (error) {
      await gameplaySignOut;
      usePrivySync.getState().retry();
      const message = error instanceof Error ? error.message : String(error);
      setSignOutError(
        /network|fetch|offline|timeout/i.test(message)
          ? 'Sign-out could not finish. Check your connection and try again.'
          : 'Sign-out could not finish. Please try again.',
      );
    } finally {
      setLoggingOut(false);
    }
  }, [loggingOut, logout, router]);

  const pickFlag = useCallback((countryCode: string) => {
    const current = useProfile.getState();
    if (current.countryCode === countryCode) return;
    current.setIdentity({ countryCode });
    if (current.userId) void pushProfile(current.userId, { countryCode });
  }, []);

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <Art source={LOGIN_ART.sailingShip} style={styles.ship} />
      <Art source={PROFILE_ART.seagull} style={styles.gullA} />
      <Art source={PROFILE_ART.seagull} style={styles.gullB} />

      <ArtImageButton
        source={SETTINGS_ART.back}
        w={72}
        h={44}
        label="Back"
        style={styles.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
      <Art source={PROFILE_ART.banner} style={styles.banner} />

      <VSlicedImage
        slices={PROFILE_ART.profilePanel}
        w={LEFT.w}
        h={LEFT.h}
        style={{ position: 'absolute', left: LEFT.x, top: LEFT.y }}
      />
      <View style={styles.leftBox}>
        <View style={styles.identity}>
          <RingPortrait
            avatarId={profile.avatarId}
            avatarColor={profile.avatarColor}
            countryCode={profile.countryCode}
          />
          <View style={styles.identityCopy}>
            <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {profile.name || 'Sailor'}
            </Text>
            <Image source={PROFILE_ART.nameUnderline} style={styles.nameUnderline} contentFit="fill" />
            <Pressable
              onPress={() => setFlagsOpen(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Flag: ${countryName(profile.countryCode)}. Change flag`}
              style={({ pressed }) => [styles.countryRow, pressed ? styles.pressed : null]}
            >
              <Text style={styles.country} numberOfLines={1}>
                {countryName(profile.countryCode)}
              </Text>
              <Text style={styles.countryChange}>Change flag</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.stats}>
          <View style={styles.statsCol}>
            <Detail label="Rank points" value={profile.rankPoints.toLocaleString()} />
            <Detail label="Battles" value={profile.battlesPlayed.toLocaleString()} />
            <Detail label="Coins" value={coins.toLocaleString()} last />
          </View>
          <View style={styles.statsCol}>
            <Detail label="Main points" value={pointBalance.toLocaleString()} />
            <Detail label="Victories" value={profile.battlesWon.toLocaleString()} />
            <Detail label="Gems" value={profile.gems.toLocaleString()} last />
          </View>
        </View>
        <CollectionStrip unlocks={wallet.unlocks} onPress={() => setCollectionOpen(true)} />
        <View style={styles.actions}>
          <ArtImageButton
            source={PROFILE_ART.changeName}
            w={131}
            h={40}
            label="Change name"
            onPress={() => router.push({ pathname: '/name', params: { next: 'back' } })}
          />
          <ArtImageButton
            source={PROFILE_ART.changeAvatar}
            w={137}
            h={40}
            label="Change avatar"
            onPress={() => router.push('/avatar')}
          />
        </View>
      </View>

      <VSlicedImage
        slices={PROFILE_ART.accountPanel}
        w={RIGHT.w}
        h={RIGHT.h}
        style={{ position: 'absolute', left: RIGHT.x, top: RIGHT.y }}
      />
      <Art source={PROFILE_ART.shipWheel} style={styles.wheel} />
      <View style={styles.rightBox}>
        <Text style={styles.panelTitle}>Secure account</Text>
        <Image source={PROFILE_ART.titleUnderline} style={styles.titleUnderline} contentFit="fill" />
        <Detail label="Name" value={displayName} />
        <Detail label="Email" value={email} />
        <Detail label="Signed in with" value={methods.join(' + ') || sync.account?.authProvider || 'Privy'} />
        <Detail label="Privy ID" value={user ? shortAddress(user.id, 10) : '—'} />
        <Detail label="Joined" value={created} />
        <Detail
          label="Solana wallet"
          value={walletAddress ? shortAddress(walletAddress, 9) : walletState.status.replace('-', ' ')}
          last
        />

        <View style={styles.syncRow} accessibilityLiveRegion="polite">
          {sync.status === 'syncing' ? <InkSpinner size={16} seedKey="profile-sync" /> : null}
          {sync.status === 'synced' ? (
            <Image source={PROFILE_ART.verified} style={styles.verified} contentFit="contain" />
          ) : null}
          <Text
            style={[styles.syncText, sync.status === 'error' ? styles.danger : null]}
            numberOfLines={2}
          >
            {sync.status === 'synced'
              ? 'Verified account saved to the game server.'
              : sync.status === 'error'
                ? sync.error
                : 'Syncing verified account…'}
          </Text>
          {sync.status === 'error' ? (
            <ArtButton
              slices={SETTINGS_ART.creamButton}
              w={72}
              h={28}
              label="Retry"
              fontSize={13}
              onPress={sync.retry}
            />
          ) : null}
        </View>

        <View style={styles.actions}>
          <ArtImageButton
            source={PROFILE_ART.openWallet}
            w={133}
            h={40}
            label="Open wallet"
            onPress={() => router.push('/wallet' as Href)}
          />
          <ArtImageButton
            source={PROFILE_ART.signOut}
            w={128}
            h={40}
            label="Sign out"
            disabled={loggingOut}
            onPress={() => {
              setSignOutError(null);
              setSignOutOpen(true);
            }}
          />
        </View>
      </View>
      <FlagPicker
        visible={flagsOpen}
        selected={profile.countryCode}
        onPick={pickFlag}
        onClose={() => setFlagsOpen(false)}
      />
      <CollectionDialog
        visible={collectionOpen}
        unlocks={wallet.unlocks}
        onClose={() => setCollectionOpen(false)}
        onStore={() => {
          setCollectionOpen(false);
          router.push('/store' as Href);
        }}
      />
      <SignOutDialog
        visible={signOutOpen}
        busy={loggingOut}
        error={signOutError}
        onCancel={() => {
          if (!loggingOut) setSignOutOpen(false);
        }}
        onConfirm={() => void confirmLogout()}
      />
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 8, top: 8 },
  banner: { left: (CANVAS_W - 290) / 2, top: 3, width: 290, height: 290 * (127 / 664) },
  ship: { left: 84, top: 2, width: 60, height: 60 },
  gullA: { left: 566, top: 22, width: 30, height: 11 },
  gullB: { left: 604, top: 38, width: 20, height: 7 },

  leftBox: {
    position: 'absolute',
    left: LEFT.x + 22,
    width: LEFT.w - 44,
    top: LEFT.y + 42,
    height: LEFT.h - 60,
    justifyContent: 'space-between',
  },
  rightBox: {
    position: 'absolute',
    left: RIGHT.x + 22,
    width: RIGHT.w - 44,
    top: RIGHT.y + 38,
    height: RIGHT.h - 56,
    justifyContent: 'space-between',
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  identityCopy: { flex: 1 },
  name: { color: artColor.ink, fontFamily: font.display, fontSize: 27, lineHeight: 32 },
  nameUnderline: { width: 118, height: 9, marginTop: 1 },
  ringFlag: { position: 'absolute', right: -10, bottom: -1, transform: [{ rotate: '-7deg' }] },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 5,
    alignSelf: 'flex-start',
  },
  pressed: { transform: [{ translateY: 1 }] },
  country: { flexShrink: 1, color: artColor.label, fontFamily: font.body, fontSize: 15 },
  countryChange: {
    color: artColor.soft,
    fontFamily: font.label,
    fontSize: 11,
    textDecorationLine: 'underline',
  },
  stats: { flexDirection: 'row', gap: 18 },
  statsCol: { flex: 1 },
  panelTitle: {
    color: artColor.ink,
    fontFamily: font.display,
    fontSize: 21,
    textAlign: 'center',
  },
  titleUnderline: { width: 150, height: 6, alignSelf: 'center', marginTop: -2 },
  wheel: { left: RIGHT.x + RIGHT.w - 62, top: RIGHT.y + 36, width: 34, height: 37, opacity: 0.8 },
  detailRow: {
    height: 19,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  detailRule: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 3, opacity: 0.7 },
  detailLabel: { color: artColor.label, fontFamily: font.body, fontSize: 13 },
  detailValue: {
    flex: 1,
    color: artColor.ink,
    fontFamily: font.label,
    fontSize: 13,
    textAlign: 'right',
  },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  syncRow: { minHeight: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  verified: { width: 17, height: 17 },
  syncText: { flexShrink: 1, color: artColor.green, fontFamily: font.body, fontSize: 12, textAlign: 'center' },
  danger: { color: color.inkRed },
  dialogDim: { flex: 1, backgroundColor: 'rgba(16,20,48,0.5)' },
  dialogCard: {
    position: 'absolute',
    left: (CANVAS_W - DIALOG.w) / 2,
    top: (CANVAS_H - DIALOG.h) / 2,
    width: DIALOG.w,
    height: DIALOG.h,
  },
  dialogBodyBox: { position: 'absolute', left: 30, right: 30, top: 44, bottom: 22, alignItems: 'center' },
  dialogKicker: { color: color.inkRed, fontFamily: font.label, fontSize: 13, textAlign: 'center' },
  dialogTitle: {
    color: artColor.ink,
    fontFamily: font.display,
    fontSize: 22,
    textAlign: 'center',
    marginTop: 2,
  },
  dialogBody: {
    color: artColor.soft,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
  },
  dialogError: { color: color.inkRed, fontFamily: font.body, fontSize: 11, textAlign: 'center', marginTop: 3 },
  dialogActions: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 'auto' },
  dialogSpinner: { position: 'absolute', right: 26, bottom: 30 },
});
