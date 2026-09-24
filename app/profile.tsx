import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { privyDisplayName, privyEmail, privyLoginMethods } from '@/features/auth/privyUser';
import { signOutGameplaySession } from '@/net/api';
import { useMatchClient } from '@/net/match-client';
import { useBattle } from '@/state/battle';
import { useCloud } from '@/state/cloud';
import { useProfile } from '@/state/profile';
import { usePoints } from '@/state/points';
import { useCurrencyInfo } from '@/state/currencyInfo';
import { usePrivySync } from '@/state/privySync';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS } from '@/ui/assets';
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { shortAddress } from '@/wallet/solana';

function Detail({
  label,
  value,
  danger = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  danger?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const row = (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[styles.detailValue, danger ? styles.danger : null]}
        numberOfLines={1}
        // A selectable Text can swallow the tap that is meant to open the
        // currency sheet, so selection is only offered on plain rows.
        selectable={!onPress}
      >
        {value}
      </Text>
    </View>
  );
  if (!onPress) return row;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}>
      {row}
    </Pressable>
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
            <InkPanel w={408} h={220} seedKey="profile-sign-out" padding={space.lg}>
              <Text style={styles.dialogKicker}>LEAVE THE SHIP?</Text>
              <Text style={styles.dialogTitle}>Sign out of this captain</Text>
              <Text style={styles.dialogBody}>
                This device will forget this account, its wallet session, and cached game details.
                Your server progress stays safe for your next sign-in.
              </Text>
              {error ? <Text style={styles.dialogError}>{error}</Text> : null}
              <View style={styles.dialogActions}>
                <InkButton label="Stay signed in" w={154} h={40} size="sm" disabled={busy} onPress={onCancel} />
                <InkButton
                  label={busy ? 'Signing out…' : 'Sign out'}
                  tone="danger"
                  w={154}
                  h={40}
                  size="sm"
                  disabled={busy}
                  onPress={onConfirm}
                />
              </View>
              {busy ? <InkSpinner size={18} seedKey="profile-signing-out" style={styles.dialogSpinner} /> : null}
            </InkPanel>
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
  const openCurrency = useCurrencyInfo((state) => state.openCurrency);
  const [loggingOut, setLoggingOut] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
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

  return (
    <Scale>
      <Paper variant="full" />
      <View style={styles.back}>
        <InkIconButton icon="back" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title="Captain’s profile" w={310} h={42} size="md" />
      </View>

      <View style={styles.leftPanel}>
        <InkPanel w={350} h={274} seedKey="game-profile" padding={space.md}>
          <View style={styles.identity}>
            <AssetSlot source={AVATARS[profile.avatarId]} w={72} h={72} label="Avatar" tintColor={profile.avatarColor} />
            <View style={styles.identityCopy}>
              <Text style={styles.name}>{profile.name || 'Sailor'}</Text>
              <Text style={styles.country}>Port: {profile.countryCode || 'Unknown'}</Text>
            </View>
          </View>
          <View style={styles.stats}>
            <Detail label="Rank points" value={profile.rankPoints.toLocaleString()} />
            <Detail
              label="Main points"
              value={pointBalance.toLocaleString()}
              accessibilityLabel="About Captain's points"
              onPress={() => openCurrency('points')}
            />
            <Detail label="Battles" value={profile.battlesPlayed.toLocaleString()} />
            <Detail label="Victories" value={profile.battlesWon.toLocaleString()} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Coins / gems</Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                <Text
                  accessibilityRole="button"
                  accessibilityLabel="About Coins"
                  onPress={() => openCurrency('coins')}
                >
                  {profile.coins.toLocaleString()}
                </Text>
                {' / '}
                <Text
                  accessibilityRole="button"
                  accessibilityLabel="About Gems"
                  onPress={() => openCurrency('gems')}
                >
                  {profile.gems.toLocaleString()}
                </Text>
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <InkButton label="Change name" w={142} h={36} size="sm" onPress={() => router.push({ pathname: '/name', params: { next: 'back' } })} />
            <InkButton label="Change avatar" w={142} h={36} size="sm" onPress={() => router.push('/avatar')} />
          </View>
        </InkPanel>
      </View>

      <View style={styles.rightPanel}>
        <InkPanel w={374} h={274} seedKey="privy-profile" padding={space.md}>
          <Text style={styles.panelTitle}>Secure account</Text>
          <Detail label="Name" value={displayName} />
          <Detail label="Email" value={email} />
          <Detail label="Signed in with" value={methods.join(' + ') || sync.account?.authProvider || 'Privy'} />
          <Detail label="Privy ID" value={user ? shortAddress(user.id, 10) : '—'} />
          <Detail label="Joined" value={created} />
          <Detail label="Solana wallet" value={walletAddress ? shortAddress(walletAddress, 9) : walletState.status.replace('-', ' ')} />

          <View style={styles.syncRow} accessibilityLiveRegion="polite">
            {sync.status === 'syncing' ? <InkSpinner size={18} seedKey="profile-sync" /> : null}
            <Text style={[styles.syncText, sync.status === 'error' ? styles.danger : null]} numberOfLines={2}>
              {sync.status === 'synced'
                ? 'Verified account saved to the game server.'
                : sync.status === 'error'
                  ? sync.error
                  : 'Syncing verified account…'}
            </Text>
            {sync.status === 'error' ? (
              <InkButton label="Retry" w={72} h={31} size="sm" onPress={sync.retry} />
            ) : null}
          </View>

          <View style={styles.actions}>
            <InkButton label="Open wallet" tone="confirm" w={142} h={36} size="sm" onPress={() => router.push('/wallet' as Href)} />
            <InkButton
              label={loggingOut ? 'Signing out…' : 'Sign out'}
              tone="danger"
              w={142}
              h={36}
              size="sm"
              disabled={loggingOut}
              onPress={() => {
                setSignOutError(null);
                setSignOutOpen(true);
              }}
            />
          </View>
        </InkPanel>
      </View>
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
  back: { position: 'absolute', left: 12, top: 8 },
  ribbon: { position: 'absolute', left: 245, top: 7 },
  leftPanel: { position: 'absolute', left: 32, top: 70 },
  rightPanel: { position: 'absolute', left: 394, top: 70 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identityCopy: { flex: 1 },
  name: { color: color.ink, fontFamily: font.display, fontSize: typeScale.lg },
  country: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs, marginTop: space.xs },
  stats: { marginTop: space.sm },
  panelTitle: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md, textAlign: 'center', marginBottom: 4 },
  detailRow: { minHeight: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  detailLabel: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.xxs },
  detailValue: { flex: 1, color: color.ink, fontFamily: font.body, fontSize: typeScale.xs, textAlign: 'right' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  syncRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2 },
  syncText: { flex: 1, color: color.inkGreen, fontFamily: font.body, fontSize: typeScale.xxs, textAlign: 'center' },
  danger: { color: color.inkRed },
  dialogDim: { flex: 1, backgroundColor: 'rgba(28,20,15,0.46)' },
  dialogCard: {
    position: 'absolute',
    left: (CANVAS_W - 408) / 2,
    top: (CANVAS_H - 220) / 2,
  },
  dialogKicker: {
    color: color.inkRed,
    fontFamily: font.label,
    fontSize: typeScale.xs,
    textAlign: 'center',
    letterSpacing: 1.1,
  },
  dialogTitle: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.lg,
    textAlign: 'center',
    marginTop: space.xs,
  },
  dialogBody: {
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xs,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: space.sm,
  },
  dialogError: {
    color: color.inkRed,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    textAlign: 'center',
    marginTop: 3,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  dialogSpinner: { position: 'absolute', right: 18, bottom: 18 },
});
