/**
 * Points exchange — drawn to its mockup on BACKGROUNDS.settings: the captain's
 * balance on the left, the buy/sell desk on the right, both on the rope-crowned
 * panel (one grid-sliced frame, so both crowns match). Every button with words
 * that change — the tabs, Pay/Finish credit, Exchange/Check payout, Refresh —
 * is an ArtPlate with a live label.
 *
 * The exchange itself is unchanged: buys are credited only after the backend
 * verifies the transfer on Solana; sells reserve the points first and restore
 * them if the payout fails.
 */
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View, type ImageStyle } from 'react-native';

import {
  confirmPointBuy,
  fetchPointQuote,
  requestPointSell,
  type PointQuote,
} from '@/net/points';
import { usePoints } from '@/state/points';
import { randomUuid } from '@/util/uuid';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { ArtPlate } from '@/ui/ArtPlate';
import {
  BACKGROUNDS,
  LOGIN_ART,
  MATCHMAKING_ART,
  POINTS_ART,
  SETTINGS_ART,
  type Asset,
} from '@/ui/assets';
import { InkSpinner } from '@/ui/InkSpinner';
import { Scale } from '@/ui/Scale';
import { GridSlicedImage } from '@/ui/SlicedImage';
import { CANVAS_W, artColor, color, font } from '@/ui/tokens';
import { readBalanceAtLeastSlot, solanaConfig } from '@/wallet/solana';

/** The panel frame's grid (points-panel): corners and crown fixed, the rest stretch. */
const PANEL_GRID = {
  cells: POINTS_ART.panel,
  stretchCols: [false, true, false, true, false],
  stretchRows: [false, true, false],
  k: 0.45,
} as const;
const LEFT = { x: 30, y: 58, w: 298, h: 284 } as const;
const RIGHT = { x: 336, y: 58, w: 436, h: 284 } as const;
/** Content starts below the crown's anchor medallion, which hangs ~36 below the frame's top. */
const CONTENT_TOP = 42;

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

type DeskTab = 'buy' | 'sell';
const NETWORK_FEE_RESERVE = 20_000;

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel|reject|declin/i.test(message)) return 'The wallet request was cancelled.';
  if (/insufficient.*sol|attempt to debit|fund/i.test(message)) return 'Your wallet does not have enough SOL.';
  if (/insufficient points/i.test(message)) return 'You need at least 100 points to sell.';
  if (/confirming/i.test(message)) return 'The transfer is still confirming. Tap “Finish credit” shortly.';
  return message.length <= 130 ? message : 'The transaction could not be completed. Please try again.';
}

export default function PointsScreen() {
  const router = useRouter();
  const walletState = useEmbeddedSolanaWallet();
  const wallet = walletState.wallets?.[0];
  const config = useMemo(solanaConfig, []);
  const connection = useMemo(() => new Connection(config.rpcUrl, 'confirmed'), [config.rpcUrl]);
  const balance = usePoints((state) => state.balance);
  const pendingBuy = usePoints((state) => state.pendingBuy);
  const pendingSellId = usePoints((state) => state.pendingSellId);
  const [tab, setTab] = useState<DeskTab>('buy');
  const [quote, setQuote] = useState<PointQuote | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (after?: { minContextSlot?: number; previousBalance?: number | null }) => {
      setLoading(true);
      setError(null);
      try {
        const nextQuote = await fetchPointQuote();
        setQuote(nextQuote);
        usePoints.getState().sync(nextQuote.balance);
        if (wallet?.address) {
          // Same read-after-write trap as the wallet screen: without this the
          // SOL figure can still be the pre-purchase one straight after a buy.
          setSolBalance(
            await readBalanceAtLeastSlot(connection, new PublicKey(wallet.address), {
              minContextSlot: after?.minContextSlot,
              differentFrom: after?.previousBalance ?? null,
            }),
          );
        }
      } catch (caught) {
        setError(friendlyError(caught));
      } finally {
        setLoading(false);
      }
    },
    [connection, wallet?.address],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const finishBuyCredit = useCallback(async () => {
    const pending = usePoints.getState().pendingBuy;
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    setNotice('Verifying the confirmed Solana transfer…');
    try {
      const result = await confirmPointBuy(pending.requestId, pending.signature);
      usePoints.getState().sync(result.balance);
      usePoints.getState().setPendingBuy(null);
      setNotice(`Purchase complete. Your balance is ${result.balance} points.`);
      await refresh();
    } catch (caught) {
      setError(friendlyError(caught));
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const buy = useCallback(async () => {
    if (!wallet || !quote || busy) return;
    if (solBalance !== null && solBalance < quote.lamports + NETWORK_FEE_RESERVE) {
      Alert.alert(
        'Add SOL first',
        `You need ${quote.sol} SOL plus a small network fee in your embedded wallet.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open wallet', onPress: () => router.push('/wallet') },
        ],
      );
      return;
    }
    setBusy(true);
    setError(null);
    setNotice('Preparing your Privy wallet request…');
    try {
      const latest = await connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction({
        feePayer: new PublicKey(wallet.address),
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }).add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(wallet.address),
          toPubkey: new PublicKey(quote.treasuryAddress),
          lamports: quote.lamports,
        }),
      );
      const provider = await wallet.getProvider();
      const sent = await provider.request({
        method: 'signAndSendTransaction',
        params: { transaction, connection, options: { preflightCommitment: 'confirmed' } },
      });
      const pending = { requestId: randomUuid(), signature: sent.signature };
      usePoints.getState().setPendingBuy(pending);
      setNotice('Transfer sent. Confirming and crediting points…');
      const confirmation = await connection.confirmTransaction(
        { signature: sent.signature, ...latest },
        'confirmed',
      );
      if (confirmation.value.err) {
        usePoints.getState().setPendingBuy(null);
        throw new Error('The Solana transfer failed. No points were charged.');
      }
      const result = await confirmPointBuy(pending.requestId, pending.signature);
      usePoints.getState().sync(result.balance);
      usePoints.getState().setPendingBuy(null);
      setNotice(`Purchase complete. ${quote.points} points were added.`);
      await refresh({
        minContextSlot: confirmation.context?.slot,
        previousBalance: solBalance,
      });
    } catch (caught) {
      setError(friendlyError(caught));
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }, [busy, connection, quote, refresh, router, solBalance, wallet]);

  const sell = useCallback(async () => {
    if (!quote || busy) return;
    const execute = async () => {
      const requestId = usePoints.getState().pendingSellId ?? randomUuid();
      usePoints.getState().setPendingSell(requestId);
      setBusy(true);
      setError(null);
      setNotice('Reserving points and preparing the treasury payout…');
      try {
        const result = await requestPointSell(requestId);
        usePoints.getState().sync(result.balance);
        if (result.status === 'pending') {
          setNotice('Payout broadcast. Tap “Check payout” if it does not confirm shortly.');
        } else {
          usePoints.getState().setPendingSell(null);
          setNotice(
            result.status === 'confirmed'
              ? `${quote.sol} SOL was sent to your Privy wallet.`
              : 'The payout could not complete, so all reserved points were restored.',
          );
          await refresh({ previousBalance: result.status === 'confirmed' ? solBalance : null });
        }
      } catch (caught) {
        if (/insufficient points/i.test(caught instanceof Error ? caught.message : String(caught))) {
          usePoints.getState().setPendingSell(null);
        }
        setError(friendlyError(caught));
        setNotice(null);
      } finally {
        setBusy(false);
      }
    };
    if (pendingSellId) {
      void execute();
      return;
    }
    if (balance < quote.points) {
      Alert.alert('Not enough points', `You need ${quote.points} points to make this exchange.`);
      return;
    }
    Alert.alert(
      'Sell points for SOL?',
      `${quote.points} points will be exchanged for ${quote.sol} SOL and sent to your embedded wallet.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm sale', onPress: () => void execute() },
      ],
    );
  }, [balance, busy, pendingSellId, quote, refresh]);

  const buyLabel = pendingBuy ? (busy ? 'Verifying…' : 'Finish credit') : busy ? 'Processing…' : 'Pay 0.001 SOL';
  const sellLabel = busy ? 'Processing…' : pendingSellId ? 'Check payout' : 'Exchange for SOL';
  const statusText =
    error ??
    notice ??
    (wallet ? 'Treasury-backed · server verified · replay protected' : 'Waiting for your Privy wallet…');

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <Art source={SETTINGS_ART.quote} style={styles.quoteTop} />

      <ArtImageButton
        source={SETTINGS_ART.back}
        w={72}
        h={44}
        label="Back"
        style={styles.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
      <Art source={POINTS_ART.banner} style={styles.banner} />

      {/* The captain's balance */}
      <GridSlicedImage {...PANEL_GRID} w={LEFT.w} h={LEFT.h} style={{ position: 'absolute', left: LEFT.x, top: LEFT.y }} />
      <View style={styles.leftBox}>
        <View style={styles.kickerRow}>
          <Image source={MATCHMAKING_ART.navyDashLeft} style={styles.kickerDash} contentFit="contain" />
          <Text style={styles.kicker}>CAPTAIN’S POINTS</Text>
          <Image source={MATCHMAKING_ART.navyDashRight} style={styles.kickerDash} contentFit="contain" />
        </View>
        <View style={styles.balanceRow}>
          <Image source={POINTS_ART.coinStack} style={styles.coins} contentFit="contain" />
          <View style={styles.balanceCol}>
            <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {balance.toLocaleString()}
            </Text>
            <Text style={styles.balanceLabel}>available points</Text>
          </View>
        </View>
        <Image source={POINTS_ART.waveDivider} style={styles.wave} contentFit="fill" />
        <Text style={styles.rate}>100 points ⇄ 0.001 SOL</Text>
        <Text style={styles.helper}>
          Wager matches reserve 50 points. The winner receives the full 100-point pot.
        </Text>
        <Image source={POINTS_ART.straightDivider} style={styles.rule} contentFit="fill" />
        <Text style={styles.solReadout}>
          Wallet: {solBalance === null ? '—' : `${(solBalance / 1_000_000_000).toFixed(6)} SOL`}
        </Text>
        <ArtPlate
          tone="cream"
          w={206}
          h={34}
          icon={POINTS_ART.refresh}
          iconSize={20}
          fontSize={15}
          label={loading ? 'Refreshing…' : 'Refresh balances'}
          disabled={loading || busy}
          onPress={() => void refresh()}
          style={styles.refresh}
        />
      </View>

      {/* The desk */}
      <GridSlicedImage {...PANEL_GRID} w={RIGHT.w} h={RIGHT.h} style={{ position: 'absolute', left: RIGHT.x, top: RIGHT.y }} />
      <View style={styles.rightBox}>
        <View style={styles.tabs}>
          <ArtPlate
            tone={tab === 'buy' ? 'green' : 'cream'}
            w={186}
            h={36}
            fontSize={16}
            label="Buy points"
            accessibilityLabel={`Buy points${tab === 'buy' ? ', selected' : ''}`}
            onPress={() => setTab('buy')}
          />
          <ArtPlate
            tone={tab === 'sell' ? 'green' : 'cream'}
            w={186}
            h={36}
            fontSize={16}
            label="Sell points"
            accessibilityLabel={`Sell points${tab === 'sell' ? ', selected' : ''}`}
            onPress={() => setTab('sell')}
          />
        </View>

        {loading && !quote ? (
          <View style={styles.loading}>
            <InkSpinner size={28} />
            <Text style={styles.copy}>Opening the points desk…</Text>
          </View>
        ) : (
          <View style={styles.desk}>
            <Art source={LOGIN_ART.sailingShip} style={styles.deskShip} />
            <Art source={MATCHMAKING_ART.compass} style={styles.deskCompass} />
            <Text style={styles.title}>{tab === 'buy' ? 'Buy 100 points' : 'Sell 100 points'}</Text>
            <Image source={POINTS_ART.waveDivider} style={styles.titleWave} contentFit="fill" />
            <Text style={styles.copy}>
              {tab === 'buy'
                ? 'Privy will ask you to approve a 0.001 SOL transfer. Points are credited only after the backend verifies it on Solana.'
                : 'The backend reserves 100 points, then sends 0.001 SOL from the treasury to your verified Privy wallet. Failed payouts restore the points.'}
            </Text>
            <View style={styles.actionRow}>
              <Image source={MATCHMAKING_ART.navyDashLeft} style={styles.actionDash} contentFit="contain" />
              {tab === 'buy' ? (
                <ArtPlate
                  tone="green"
                  w={246}
                  h={42}
                  icon={POINTS_ART.wallet}
                  iconSize={26}
                  fontSize={19}
                  label={buyLabel}
                  disabled={busy || (!pendingBuy && (!wallet || !quote))}
                  onPress={() => void (pendingBuy ? finishBuyCredit() : buy())}
                />
              ) : (
                <ArtPlate
                  tone="green"
                  w={246}
                  h={42}
                  icon={POINTS_ART.wallet}
                  iconSize={26}
                  fontSize={19}
                  label={sellLabel}
                  disabled={busy || !quote || !wallet}
                  onPress={() => void sell()}
                />
              )}
              <Image source={MATCHMAKING_ART.navyDashRight} style={styles.actionDash} contentFit="contain" />
            </View>
          </View>
        )}

        <View style={styles.status} accessibilityLiveRegion="polite">
          {error ? null : <Image source={POINTS_ART.shieldCheck} style={styles.shield} contentFit="contain" />}
          <Text style={[styles.statusText, error ? styles.error : null]} numberOfLines={2}>
            {statusText}
          </Text>
        </View>
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 8, top: 8 },
  banner: { left: (CANVAS_W - 300) / 2, top: 0, width: 300, height: 300 * (156 / 738) },
  quoteTop: { left: 706, top: 4, width: 80, height: 51 },

  leftBox: {
    position: 'absolute',
    left: LEFT.x + 16,
    width: LEFT.w - 32,
    top: LEFT.y + CONTENT_TOP,
    height: LEFT.h - CONTENT_TOP - 12,
    alignItems: 'center',
  },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerDash: { width: 7, height: 16 },
  kicker: { color: artColor.navy, fontFamily: font.display, fontSize: 15, letterSpacing: 0.6 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  coins: { width: 70, height: 43 },
  balanceCol: { alignItems: 'center', minWidth: 110 },
  balance: {
    color: '#1B8A38',
    fontFamily: font.display,
    fontSize: 36,
    lineHeight: 40,
    textShadowColor: 'rgba(10,60,20,0.18)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  balanceLabel: { color: artColor.navy, fontFamily: font.body, fontSize: 13, marginTop: -3 },
  wave: { width: 180, height: 180 * (36 / 359), marginTop: 2 },
  rate: { color: artColor.ink, fontFamily: font.display, fontSize: 18, marginTop: 2 },
  helper: {
    color: artColor.navy,
    fontFamily: font.body,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 2,
  },
  rule: { width: 220, height: 4, marginTop: 5, opacity: 0.8 },
  solReadout: { color: artColor.ink, fontFamily: font.label, fontSize: 13, marginTop: 3 },
  refresh: { marginTop: 'auto' },

  rightBox: {
    position: 'absolute',
    left: RIGHT.x + 20,
    width: RIGHT.w - 40,
    top: RIGHT.y + CONTENT_TOP,
    height: RIGHT.h - CONTENT_TOP - 12,
  },
  tabs: { flexDirection: 'row', justifyContent: 'space-between' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  desk: { flex: 1, alignItems: 'center', paddingTop: 6 },
  deskShip: { left: 2, top: 10, width: 44, height: 44, opacity: 0.9 },
  deskCompass: { right: 2, top: 52, width: 38, height: 39, opacity: 0.85 },
  title: { color: artColor.ink, fontFamily: font.display, fontSize: 25, lineHeight: 30 },
  titleWave: { width: 170, height: 170 * (36 / 359), marginTop: 1 },
  copy: {
    color: artColor.navy,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 44,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 'auto', marginBottom: 4 },
  actionDash: { width: 8, height: 20 },
  status: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  shield: { width: 15, height: 17 },
  statusText: { flexShrink: 1, color: artColor.green, fontFamily: font.body, fontSize: 12, textAlign: 'center' },
  error: { color: color.inkRed },
});
