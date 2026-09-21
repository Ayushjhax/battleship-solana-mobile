import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import {
  confirmPointBuy,
  fetchPointQuote,
  requestPointSell,
  type PointQuote,
} from '@/net/points';
import { usePoints } from '@/state/points';
import { randomUuid } from '@/util/uuid';
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { color, font, space, type as typeScale } from '@/ui/tokens';
import { readBalanceAtLeastSlot, solanaConfig } from '@/wallet/solana';

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

  return (
    <Scale>
      <Paper variant="full" />
      <View style={styles.back}>
        <InkIconButton
          icon="back"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
        />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title="Points exchange" w={310} h={42} size="md" />
      </View>

      <View style={styles.account}>
        <InkPanel w={270} h={272} seedKey="points-account" padding={space.md}>
          <Text style={styles.kicker}>CAPTAIN’S POINTS</Text>
          <Text style={styles.balance}>{balance.toLocaleString()}</Text>
          <Text style={styles.balanceLabel}>available points</Text>
          <View style={styles.rule} />
          <Text style={styles.rate}>100 points ⇄ 0.001 SOL</Text>
          <Text style={styles.helper}>
            Wager matches reserve 50 points. The winner receives the full 100-point pot.
          </Text>
          <Text style={styles.solReadout}>
            Wallet: {solBalance === null ? '—' : `${(solBalance / 1_000_000_000).toFixed(6)} SOL`}
          </Text>
          <InkButton
            label={loading ? 'Refreshing…' : 'Refresh balances'}
            w={210}
            h={36}
            size="sm"
            style={styles.refreshButton}
            disabled={loading || busy}
            onPress={() => void refresh()}
          />
        </InkPanel>
      </View>

      <View style={styles.trade}>
        <InkPanel w={470} h={272} seedKey="points-trade" padding={space.md}>
          <View style={styles.tabs}>
            <InkButton label="Buy points" tone={tab === 'buy' ? 'confirm' : 'ink'} w={200} h={36} size="sm" onPress={() => setTab('buy')} />
            <InkButton label="Sell points" tone={tab === 'sell' ? 'confirm' : 'ink'} w={200} h={36} size="sm" onPress={() => setTab('sell')} />
          </View>
          {loading && !quote ? (
            <View style={styles.loading}><InkSpinner size={28} /><Text style={styles.helper}>Opening the points desk…</Text></View>
          ) : tab === 'buy' ? (
            <View style={styles.body}>
              <Text style={styles.title}>Buy 100 points</Text>
              <Text style={styles.copy}>Privy will ask you to approve a 0.001 SOL transfer. Points are credited only after the backend verifies it on Solana.</Text>
              {pendingBuy ? (
                <InkButton label={busy ? 'Verifying…' : 'Finish credit'} tone="confirm" w={210} h={42} size="sm" disabled={busy} onPress={() => void finishBuyCredit()} />
              ) : (
                <InkButton label={busy ? 'Processing…' : 'Pay 0.001 SOL'} tone="confirm" w={210} h={42} size="sm" disabled={busy || !wallet || !quote} onPress={() => void buy()} />
              )}
            </View>
          ) : (
            <View style={styles.body}>
              <Text style={styles.title}>Sell 100 points</Text>
              <Text style={styles.copy}>The backend reserves 100 points, then sends 0.001 SOL from the treasury to your verified Privy wallet. Failed payouts restore the points.</Text>
              <InkButton label={busy ? 'Processing…' : pendingSellId ? 'Check payout' : 'Exchange for SOL'} tone="confirm" w={210} h={42} size="sm" disabled={busy || !quote || !wallet} onPress={() => void sell()} />
            </View>
          )}
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Text style={[styles.noticeText, error ? styles.error : null]} numberOfLines={2}>
              {error ?? notice ?? (wallet ? 'Treasury-backed · server verified · replay protected' : 'Waiting for your Privy wallet…')}
            </Text>
          </View>
        </InkPanel>
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 12, top: 8 },
  ribbon: { position: 'absolute', left: 245, top: 7 },
  account: { position: 'absolute', left: 24, top: 70 },
  trade: { position: 'absolute', left: 306, top: 70 },
  kicker: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.xs, textAlign: 'center', letterSpacing: 1 },
  balance: { color: color.inkGreen, fontFamily: font.display, fontSize: 36, lineHeight: 40, textAlign: 'center', marginTop: 2 },
  balanceLabel: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs, textAlign: 'center' },
  rule: { height: 1, backgroundColor: color.inkFaint, marginVertical: 5 },
  rate: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md, textAlign: 'center' },
  helper: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs, lineHeight: 15, textAlign: 'center' },
  solReadout: { color: color.ink, fontFamily: font.label, fontSize: typeScale.xs, textAlign: 'center', marginVertical: 5 },
  refreshButton: { alignSelf: 'center' },
  tabs: { flexDirection: 'row', justifyContent: 'space-between' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: 22 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  title: { color: color.ink, fontFamily: font.display, fontSize: typeScale.xl },
  copy: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.sm, lineHeight: 19, textAlign: 'center' },
  notice: { position: 'absolute', left: 20, right: 20, bottom: 8, alignItems: 'center' },
  noticeText: { color: color.inkGreen, fontFamily: font.body, fontSize: typeScale.xxs, textAlign: 'center' },
  error: { color: color.inkRed },
});
