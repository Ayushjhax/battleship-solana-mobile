/**
 * Wallets — which of the account's Solana wallets pays for points and receives
 * sales, and linking the player's own wallet app (Mobile Wallet Adapter,
 * Android). Drawn on the points desk's rope-crowned panel, one wide sheet.
 *
 * Three different things, kept apart on purpose:
 *   Use to pay    the server's payment wallet (POST /wallets/payment): only a
 *                 wallet the server verified from Privy can be chosen. Orders
 *                 and sales already started keep the wallet they were made for.
 *   Disconnect    forgets this phone's wallet-app connection and asks the
 *                 wallet to revoke it. The wallet stays linked to the account
 *                 and still receives sales; paying from it connects again.
 *   Unlink        removes the wallet from the Privy account: it no longer signs
 *                 in, pays or gets paid. Refused while it is the only way to
 *                 sign in, or while it is the payment wallet. Nothing moves.
 *
 * Linking signs Privy's challenge in the wallet app (src/features/auth/walletAuth.ts)
 * and never pays; the wallet is listed once the server's Privy sync records
 * it, or reported when the server holds it for another account.
 */
import { usePrivy, useUnlinkWallet } from '@privy-io/expo';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { unlinkRefusal } from '@/features/auth/privyUser';
import { useWalletAuth } from '@/features/auth/useWalletAuth';
import { walletAuthError } from '@/features/auth/walletAuth';
import { awaitLinkedWallet, walletRows, type WalletRow } from '@/features/wallet/paymentWallets';
import { WALLET_INK } from '@/features/wallet/WalletParts';
import { choosePaymentWallet, fetchAccountWallets, PointsRequestError, type AccountWallets } from '@/net/points';
import { usePrivySync } from '@/state/privySync';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { ArtPlate } from '@/ui/ArtPlate';
import { BACKGROUNDS, POINTS_ART, SETTINGS_ART, WALLET_ART } from '@/ui/assets';
import { InkSpinner } from '@/ui/InkSpinner';
import { Scale } from '@/ui/Scale';
import { GridSlicedImage } from '@/ui/SlicedImage';
import { CANVAS_W, artColor, color, font } from '@/ui/tokens';
import { mwa, mwaSupported } from '@/wallet/mwa';
import type { MwaAccount } from '@/wallet/mwaCore';
import { shortAddress, solanaConfig } from '@/wallet/solana';

const PANEL = { x: 30, y: 58, w: 740, h: 290 } as const;
const PANEL_GRID = {
  cells: POINTS_ART.panel,
  stretchCols: [false, true, false, true, false],
  stretchRows: [false, true, false],
  k: 0.45,
} as const;
/** Content starts below the crown's anchor medallion. */
const CONTENT_TOP = 42;
const MAX_ROWS = 4;

const NO_CONFLICTS: readonly string[] = [];

function problemText(wallets: AccountWallets | null): string | null {
  switch (wallets?.paymentWallet.problem) {
    case 'payment_wallet_unavailable':
      return 'The wallet you chose to pay with is no longer linked. Choose another below.';
    case 'payment_wallet_not_chosen':
      return 'Choose which wallet pays for points and receives sales.';
    case 'no_payment_wallet':
      return 'No verified wallet yet. Link your Solana wallet below.';
    default:
      return null;
  }
}

function requestError(error: unknown): string {
  if (error instanceof PointsRequestError && error.code === 'wallet_conflict') {
    return 'That wallet belongs to another game account on the server. Nothing was changed.';
  }
  if (error instanceof PointsRequestError && error.code === 'wallet_not_verified') {
    return 'That wallet is not verified for this account yet. Refresh in a moment.';
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 120 ? message : 'That did not go through. Please try again.';
}

export default function WalletsScreen() {
  const router = useRouter();
  const { user, refreshUser } = usePrivy();
  const { unlinkWallet } = useUnlinkWallet();
  const walletAuth = useWalletAuth();
  const conflicts = usePrivySync((state) => state.account?.walletConflicts ?? NO_CONFLICTS);
  const network = solanaConfig().cluster;
  const [wallets, setWallets] = useState<AccountWallets | null>(null);
  const [connected, setConnected] = useState<MwaAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWallets(await fetchAccountWallets());
      setConnected(userId ? await mwa.restore(userId) : null);
    } catch (caught) {
      setError(requestError(caught));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** One action at a time; `busy` alone is state and lets a double tap through. */
  const run = useCallback(async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const rows = walletRows(wallets, connected).slice(0, MAX_ROWS);
  const payingAddress = wallets?.paymentWallet.problem ? null : (wallets?.paymentWallet.address ?? null);
  const serverNetwork = wallets?.network ?? 'unknown';

  const choose = (row: WalletRow) => {
    Alert.alert(
      `Pay with ${row.name}?`,
      `Points will be paid for from this wallet, and sales paid to it, on Solana ${serverNetwork === 'unknown' ? network : serverNetwork}:\n\n${row.address}\n\n` +
        'Purchases and sales already started keep the wallet they were made with.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Use to pay',
          onPress: () =>
            void run(async () => {
              try {
                await choosePaymentWallet(row.address);
                setNotice(`${row.name} now pays for points and receives sales.`);
                await load();
              } catch (caught) {
                setError(requestError(caught));
              }
            }),
        },
      ],
    );
  };

  const link = () =>
    void run(async () => {
      setNotice('Opening your wallet app — approve the connection, then sign the message.');
      try {
        const account = await walletAuth.connect('link');
        setNotice(`Linked ${shortAddress(account.address, 4)}. Waiting for the game server to verify it…`);
        const settled = await awaitLinkedWallet({
          address: account.address,
          load: fetchAccountWallets,
          conflicts: () => usePrivySync.getState().account?.walletConflicts ?? [],
        });
        if (settled.wallets) setWallets(settled.wallets);
        if (userId) setConnected(await mwa.restore(userId));
        if (settled.state === 'conflict') {
          setNotice(null);
          setError('That wallet is held by another game account on the server, so it cannot pay or be paid here. Nothing moved.');
        } else if (settled.state === 'pending') {
          setNotice('Linked. The game server has not verified it yet — come back in a moment to use it for payments.');
        } else {
          setNotice(`Linked ${shortAddress(account.address, 4)}. Choose “Use to pay” to pay and get paid with it.`);
        }
      } catch (caught) {
        setNotice(null);
        setError(walletAuthError(caught).message);
      }
    });

  const disconnect = () => {
    if (!connected || !userId) return;
    Alert.alert(
      'Disconnect your wallet app?',
      'This phone forgets the connection, and your wallet app is asked to revoke it (it opens briefly). ' +
        'The wallet stays linked to your account and still receives sales. Paying from it will ask you to connect again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          onPress: () =>
            void run(async () => {
              const { revoked } = await mwa.disconnect(userId);
              setConnected(null);
              setNotice(
                revoked
                  ? 'Disconnected, and your wallet revoked this game’s access. It stays linked to your account.'
                  : 'Forgotten on this phone. The wallet stays linked to your account.',
              );
            }),
        },
      ],
    );
  };

  const unlink = (row: WalletRow) => {
    const refusal = unlinkRefusal(user ?? null, row.address, payingAddress);
    if (refusal) {
      setNotice(null);
      setError(refusal);
      return;
    }
    Alert.alert(
      `Unlink ${row.name}?`,
      `${row.address}\n\nIt will no longer sign you in, pay for points or receive sales. Your points and SOL do not move, ` +
        'and a sale already started still pays it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              try {
                await unlinkWallet({ address: row.address });
                if (connected?.address === row.address) await mwa.clear();
                await refreshUser().catch(() => undefined);
                usePrivySync.getState().retry();
                setNotice(`${row.name} was unlinked from your account.`);
                await load();
              } catch (caught) {
                setError(walletAuthError(caught).message);
              }
            }),
        },
      ],
    );
  };

  const status =
    error ??
    notice ??
    problemText(wallets) ??
    (conflicts.length > 0
      ? `${conflicts.map((address) => shortAddress(address, 4)).join(', ')} is held by another game account and cannot pay here.`
      : mwaSupported
        ? 'Only wallets the game server verified can pay or be paid.'
        : 'Connecting a wallet app needs the Android version of the game.');

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <ArtImageButton
        source={SETTINGS_ART.back}
        w={72}
        h={44}
        label="Back"
        style={styles.back}
        disabled={busy}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/points'))}
      />
      <View style={styles.banner} pointerEvents="none" accessibilityRole="header">
        <Image source={WALLET_ART.banner} style={StyleSheet.absoluteFill} contentFit="fill" />
        <Text style={styles.bannerText}>Wallets</Text>
      </View>

      <GridSlicedImage {...PANEL_GRID} w={PANEL.w} h={PANEL.h} style={{ position: 'absolute', left: PANEL.x, top: PANEL.y }} />
      <View style={styles.box}>
        <Text style={styles.lead}>
          The wallet marked “Pays” pays for points and receives sales · Solana{' '}
          {serverNetwork === 'unknown' ? network : serverNetwork}
        </Text>

        <View style={styles.list}>
          {loading && !wallets ? (
            <View style={styles.loading}>
              <InkSpinner size={24} seedKey="wallets-loading" />
              <Text style={styles.lead}>Reading your wallets…</Text>
            </View>
          ) : rows.length === 0 ? (
            <Text style={styles.empty}>No verified wallets yet.</Text>
          ) : (
            rows.map((row, index) => (
              <View key={row.address} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={styles.address} numberOfLines={1} selectable accessibilityLabel={`Address ${row.address}`}>
                  {shortAddress(row.address, 5)}
                </Text>
                <Text style={[styles.tag, row.paying ? styles.tagPaying : null]} numberOfLines={1}>
                  {row.paying ? 'Pays' : row.connectedHere ? 'Connected here' : row.kind === 'embedded' ? 'In this app' : 'Linked'}
                </Text>
                <View style={styles.rowActions}>
                  {row.paying ? null : (
                    <ArtPlate
                      tone="cream"
                      w={112}
                      h={30}
                      fontSize={13}
                      label="Use to pay"
                      accessibilityLabel={`Use ${row.name} ${row.address} to pay for points and receive sales`}
                      disabled={busy}
                      onPress={() => choose(row)}
                    />
                  )}
                  {row.kind === 'external' ? (
                    <ArtPlate
                      tone="cream"
                      w={76}
                      h={30}
                      fontSize={13}
                      label="Unlink"
                      accessibilityLabel={`Unlink ${row.name} ${row.address} from your account`}
                      disabled={busy}
                      onPress={() => unlink(row)}
                    />
                  ) : null}
                </View>
                {index < rows.length - 1 ? (
                  <Image source={SETTINGS_ART.dashedDivider} style={styles.rule} contentFit="fill" />
                ) : null}
              </View>
            ))
          )}
        </View>

        <View style={styles.actions}>
          <ArtPlate
            tone="green"
            w={226}
            h={38}
            fontSize={16}
            icon={POINTS_ART.wallet}
            iconSize={22}
            label={walletAuth.busy ? 'Waiting for wallet…' : 'Link Solana wallet'}
            accessibilityLabel="Link a Solana wallet app to this account"
            disabled={busy || !mwaSupported || !userId}
            onPress={link}
          />
          <ArtPlate
            tone="cream"
            w={226}
            h={38}
            fontSize={15}
            label="Disconnect wallet app"
            accessibilityLabel={
              connected
                ? `Disconnect the wallet app connection for ${connected.address} on this phone`
                : 'Disconnect wallet app: no wallet app is connected on this phone'
            }
            disabled={busy || !connected}
            onPress={disconnect}
          />
          <ArtPlate
            tone="cream"
            w={150}
            h={38}
            fontSize={15}
            icon={POINTS_ART.refresh}
            iconSize={18}
            label={loading ? 'Refreshing…' : 'Refresh'}
            disabled={busy || loading}
            onPress={() => {
              setError(null);
              setNotice(null);
              void load();
            }}
          />
        </View>

        <View style={styles.status} accessibilityLiveRegion="polite">
          {busy ? <InkSpinner size={16} seedKey="wallets-action" /> : null}
          <Text style={[styles.statusText, error ? styles.error : null]} numberOfLines={2}>
            {status}
          </Text>
        </View>
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 8, top: 8 },
  banner: {
    position: 'absolute',
    left: (CANVAS_W - 300) / 2,
    top: 2,
    width: 300,
    height: 300 * (127 / 664),
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: { color: WALLET_INK, fontFamily: font.display, fontSize: 23, marginTop: -3 },
  box: {
    position: 'absolute',
    left: PANEL.x + 26,
    width: PANEL.w - 52,
    top: PANEL.y + CONTENT_TOP,
    height: PANEL.h - CONTENT_TOP - 14,
  },
  lead: { color: artColor.navy, fontFamily: font.body, fontSize: 13, textAlign: 'center' },
  list: { height: 4 * 34 + 4, marginTop: 6 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  empty: { color: artColor.soft, fontFamily: font.body, fontSize: 13, textAlign: 'center', marginTop: 40 },
  row: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { width: 186, color: artColor.ink, fontFamily: font.label, fontSize: 14 },
  address: { width: 150, color: artColor.navy, fontFamily: font.body, fontSize: 13 },
  tag: { width: 112, color: artColor.soft, fontFamily: font.body, fontSize: 12.5 },
  tagPaying: { color: artColor.green, fontFamily: font.label },
  rowActions: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  rule: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 3, opacity: 0.7 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 'auto' },
  status: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4 },
  statusText: { flexShrink: 1, color: artColor.green, fontFamily: font.body, fontSize: 12, textAlign: 'center' },
  error: { color: color.inkRed },
});
