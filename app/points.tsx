/**
 * Points exchange — drawn to its mockup on BACKGROUNDS.settings: the captain's
 * balance on the left, the buy/sell desk on the right, both on the rope-crowned
 * panel (one grid-sliced frame, so both crowns match). Every button with words
 * that change — the tabs, Pay/Finish credit, Exchange/Check payout, Refresh —
 * is an ArtPlate with a live label.
 *
 * Buys are credited only after the backend verifies the transfer on Solana,
 * and go through an order made first (src/features/points/purchase.ts) — so a
 * payment the app never got to report is still found and credited, once.
 * Sells reserve the points first and restore them if the payout fails; the
 * server fixes each sale's destination when it reserves the points.
 *
 * The account's payment wallet (0018) decides who pays and who is paid: the
 * embedded game wallet by default, or a verified external wallet the player
 * chose (app/wallets.tsx). An order for the external wallet is paid only by
 * that wallet, over Mobile Wallet Adapter, after the player has seen the
 * order's details here and approved the transfer in the wallet app — never by
 * the embedded wallet. The quote is re-read whenever the desk comes back into
 * view, so a payment wallet changed elsewhere is never paid from stale figures.
 */
import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { Connection, PublicKey } from '@solana/web3.js';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View, type ImageStyle } from 'react-native';

import { purchaseApproval, saleConfirmation } from '@/features/points/confirmations';
import { ordersToReconcile, tradeExplorerUrl, tradeLine } from '@/features/points/history';
import {
  buyPoints,
  resumePurchase,
  type PurchaseDeps,
  type PurchaseOutcome,
  type Transfer,
} from '@/features/points/purchase';
import { buildTransferTransaction, isExactTransfer, type Blockhash } from '@/features/points/transfer';
import {
  confirmPointBuy,
  createPointBuyOrder,
  fetchPointQuote,
  fetchPointTrades,
  reconcilePointBuy,
  sellableOf,
  requestPointSell,
  type PaymentWallet,
  type PointQuote,
  type PointTradeHistory,
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
import { mwa, mwaSupported } from '@/wallet/mwa';
import { MwaError, type MwaAccount } from '@/wallet/mwaCore';
import {
  formatLamports,
  isRentError,
  readBalanceAtLeastSlot,
  solanaConfig,
  SOL_TRANSFER_FEE_LAMPORTS,
  transferShortfall,
} from '@/wallet/solana';

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

type DeskTab = 'buy' | 'sell' | 'history';

const TABS: readonly { id: DeskTab; label: string }[] = [
  { id: 'buy', label: 'Buy points' },
  { id: 'sell', label: 'Sell points' },
  { id: 'history', label: 'History' },
];

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** "your game wallet 7xKX…9fGh": which wallet pays, or is paid. */
function walletPhrase(wallet: PaymentWallet | undefined, fallback: string | undefined): string {
  if (wallet?.address && wallet.kind) {
    return `your ${wallet.kind === 'embedded' ? 'game wallet' : 'external wallet'} ${shortAddress(wallet.address)}`;
  }
  return fallback ? `your game wallet ${shortAddress(fallback)}` : 'your game wallet';
}

const PAYMENT_WALLET_PROBLEM: Record<NonNullable<PaymentWallet['problem']>, string> = {
  payment_wallet_unavailable: 'Your chosen payment wallet is no longer linked. Choose a payment wallet again.',
  payment_wallet_not_chosen: 'Choose which of your wallets pays for points.',
  no_payment_wallet: 'This account has no verified Solana wallet yet.',
};

/** The player closed the payment details without going ahead: the wallet was never asked. */
class PaymentCancelled extends Error {
  readonly nothingSent = true;

  constructor() {
    super('Payment cancelled. Nothing was charged.');
    this.name = 'PaymentCancelled';
  }
}

/** Words for a wallet app request that did not finish, by whether it can have paid. */
function walletAppError(error: MwaError): string {
  if (error.kind === 'declined') return 'You declined in your wallet. Nothing was charged.';
  if (error.kind === 'cancelled' || error.kind === 'authorization_failed') {
    return `${error.kind === 'cancelled' ? 'The wallet was closed' : 'Your wallet did not approve the connection'}. Nothing was charged.`;
  }
  if (error.mayHaveSent) {
    return 'Your wallet did not confirm. If you approved, tap “Finish credit”: the server finds it, and you won’t pay twice.';
  }
  return error.message;
}

function friendlyError(error: unknown): string {
  if (error instanceof PaymentCancelled) return error.message;
  if (error instanceof MwaError) return walletAppError(error);
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel|reject|declin/i.test(message)) return 'The wallet request was cancelled.';
  if (isRentError(message)) {
    return 'Solana needs a small minimum (about 0.00065 SOL) left in your wallet. Add a little more SOL.';
  }
  if (/insufficient (funds|lamports|sol)|attempt to debit/i.test(message)) {
    return 'Your wallet does not have enough SOL.';
  }
  if (/insufficient points/i.test(message)) return 'You need at least 100 points to sell.';
  if (/welcome points/i.test(message)) {
    return 'Welcome points are for playing, not for exchange. Only points you bought or won can be sold.';
  }
  if (/confirming/i.test(message)) return 'The transfer is still confirming. Tap “Finish credit” shortly.';
  return message.length <= 130 ? message : 'The transaction could not be completed. Please try again.';
}

export default function PointsScreen() {
  const router = useRouter();
  const { user } = usePrivy();
  const walletState = useEmbeddedSolanaWallet();
  const wallet = walletState.wallets?.[0];
  const config = useMemo(solanaConfig, []);
  const connection = useMemo(() => new Connection(config.rpcUrl, 'confirmed'), [config.rpcUrl]);
  const balance = usePoints((state) => state.balance);
  const pendingBuy = usePoints((state) => state.pendingBuy);
  const pendingSellId = usePoints((state) => state.pendingSellId);
  const [tab, setTab] = useState<DeskTab>('buy');
  const [quote, setQuote] = useState<PointQuote | null>(null);
  const [history, setHistory] = useState<PointTradeHistory | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [rentExemptMinimum, setRentExemptMinimum] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<MwaAccount | null>(null);
  const reconciled = useRef(false);
  // `busy` is state, so two taps inside one frame both read it as false. This
  // is set synchronously: one purchase, sale or credit check at a time.
  const inFlight = useRef(false);

  // Whose SOL is shown: the wallet that pays, which is the embedded one unless
  // the account chose a verified external wallet. Reading a balance needs no signature.
  const payingAddress = quote?.paymentWallet?.address ?? wallet?.address ?? null;
  const paymentProblem = quote?.paymentWallet?.problem ?? null;
  const payingExternal = quote?.paymentWallet?.kind === 'external';

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await fetchPointTrades());
    } catch {
      // History is a view; the desk works without it.
    }
  }, []);

  const refresh = useCallback(
    async (after?: { minContextSlot?: number; previousBalance?: number | null }) => {
      setLoading(true);
      setError(null);
      try {
        const nextQuote = await fetchPointQuote();
        setQuote(nextQuote);
        usePoints.getState().sync(nextQuote.balance);
        const address = nextQuote.paymentWallet?.address ?? wallet?.address;
        if (address) {
          // Same read-after-write trap as the wallet screen: without this the
          // SOL figure can still be the pre-purchase one straight after a buy.
          setSolBalance(
            await readBalanceAtLeastSlot(connection, new PublicKey(address), {
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
      void loadHistory();
    },
    [connection, loadHistory, wallet?.address],
  );

  // On every return to the desk, not just the first: the payment wallet may
  // have been changed on the wallets screen, and a quote for the old one must
  // not be paid from.
  const userId = user?.id ?? null;
  useFocusEffect(
    useCallback(() => {
      void refresh();
      if (userId) {
        void mwa
          .restore(userId)
          .then(setConnected)
          .catch(() => setConnected(null));
      }
    }, [refresh, userId]),
  );

  // A payment the app never got to report — it closed, or the account signed
  // out, before crediting — is found by the server and credited once. Asked
  // once per visit, for recent orders still awaiting payment.
  useEffect(() => {
    if (!history || reconciled.current) return;
    reconciled.current = true;
    const pendingId = usePoints.getState().pendingBuy?.requestId;
    const ids = ordersToReconcile(history.trades, Date.now()).filter((id) => id !== pendingId);
    if (ids.length === 0) return;
    void (async () => {
      let credited = false;
      for (const id of ids) {
        try {
          credited = (await reconcilePointBuy(id)).status === 'confirmed' || credited;
        } catch {
          // Checked again next visit.
        }
      }
      if (credited) {
        setNotice('A payment that had not been credited was found and credited.');
        await refresh();
      }
    })();
  }, [history, refresh]);

  useEffect(() => {
    connection
      .getMinimumBalanceForRentExemption(0, 'confirmed')
      .then(setRentExemptMinimum)
      .catch(() => {});
  }, [connection]);

  /** The network's own fee estimate for the transfer, or null when the RPC gives none. */
  const estimateFee = useCallback(
    async (transfer: Transfer): Promise<number | null> => {
      try {
        const latest = await connection.getLatestBlockhash('confirmed');
        const fee = await connection.getFeeForMessage(buildTransferTransaction(transfer, latest).compileMessage(), 'confirmed');
        return typeof fee.value === 'number' ? fee.value : null;
      } catch {
        return null;
      }
    },
    [connection],
  );

  /**
   * The purchase steps' wiring: the server's order, and the signer the order
   * is for — Privy's embedded wallet, or the player's wallet app over MWA.
   */
  const purchaseDeps = useCallback(
    (signer: string, signerKind: 'embedded' | 'external', landed: { slot?: number }): PurchaseDeps => {
      let latest: Blockhash | null = null;
      let orderExpiresAt = Number.NaN;
      const payEmbedded = async (transfer: Transfer): Promise<string> => {
        if (!wallet) throw new Error('Your game wallet is not ready yet.');
        setNotice('Waiting for your approval in the Privy wallet…');
        latest = await connection.getLatestBlockhash('confirmed');
        const transaction = buildTransferTransaction(transfer, latest);
        const provider = await wallet.getProvider();
        const sent = await provider.request({
          method: 'signAndSendTransaction',
          params: { transaction, connection, options: { preflightCommitment: 'confirmed' } },
        });
        setNotice('Transfer sent. Waiting for Solana to confirm it…');
        return sent.signature;
      };
      const payExternal = async (transfer: Transfer): Promise<string> => {
        if (!userId) throw new MwaError('session_changed', 'Sign in again to pay. Nothing was charged.');
        setNotice('Approve the transfer in your wallet app…');
        const signature = await mwa.signAndSend({
          userId,
          payer: transfer.from,
          // Runs once the wallet has authorized exactly the order's payer.
          prepare: async () => {
            if (!(Date.now() < orderExpiresAt)) {
              throw new MwaError('expired', 'That order expired before your wallet connected. Nothing was charged; start a new one.');
            }
            const fresh = await connection.getLatestBlockhashAndContext('confirmed');
            latest = fresh.value;
            const transaction = buildTransferTransaction(transfer, fresh.value);
            if (!isExactTransfer(transaction, transfer)) {
              throw new MwaError('failed', 'The payment could not be prepared. Nothing was charged.');
            }
            return { transaction, minContextSlot: fresh.context.slot };
          },
        });
        setNotice('Your wallet sent the transfer. Waiting for Solana to confirm it…');
        return signature;
      };
      return {
        newRequestId: randomUuid,
        savePending: (pending) => usePoints.getState().setPendingBuy(pending),
        createOrder: createPointBuyOrder,
        signerAddress: signer,
        signerKind,
        expected: quote ? { treasuryAddress: quote.treasuryAddress, lamports: quote.lamports } : undefined,
        appNetwork: config.cluster,
        approveOrder:
          signerKind === 'external'
            ? async (order) => {
                orderExpiresAt = Date.parse(order.expiresAt);
                setNotice('Checking the network fee…');
                const feeLamports = await estimateFee({
                  from: order.payer.address,
                  to: order.treasuryAddress,
                  lamports: order.lamports,
                });
                const approval = purchaseApproval(order, {
                  feeLamports,
                  walletLabel: connected?.address === order.payer.address ? connected.label : null,
                });
                setNotice('Review the payment…');
                await new Promise<void>((resolve, reject) => {
                  const cancel = () => reject(new PaymentCancelled());
                  Alert.alert(
                    approval.title,
                    approval.body,
                    [
                      { text: 'Cancel', style: 'cancel', onPress: cancel },
                      { text: 'Continue in wallet', onPress: () => resolve() },
                    ],
                    { cancelable: true, onDismiss: cancel },
                  );
                });
              }
            : undefined,
        pay: signerKind === 'external' ? payExternal : payEmbedded,
        confirmOnChain: async (signature) => {
          if (!latest) throw new Error('The transfer was not prepared.');
          const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
          landed.slot = confirmation.context?.slot;
          if (!confirmation.value.err) setNotice('Confirmed on Solana. The server is verifying it…');
          return !confirmation.value.err;
        },
        confirmCredit: async (requestId, signature) => confirmPointBuy(requestId, signature),
        reconcile: reconcilePointBuy,
        legacyQuote: quote ? { treasuryAddress: quote.treasuryAddress, lamports: quote.lamports } : null,
        now: Date.now,
      };
    },
    [config.cluster, connected, connection, estimateFee, quote, userId, wallet],
  );

  const settle = useCallback(
    async (outcome: PurchaseOutcome, landed: { slot?: number }) => {
      if (outcome.kind === 'credited') {
        usePoints.getState().sync(outcome.balance);
        setNotice(`Purchase complete: 100 points credited after the server verified your payment.`);
        await refresh({ minContextSlot: landed.slot, previousBalance: solBalance });
        return;
      }
      if (outcome.kind === 'waiting') {
        setNotice(outcome.message);
        return;
      }
      setNotice(null);
      setError(outcome.message);
      void loadHistory();
    },
    [loadHistory, refresh, solBalance],
  );

  const finishBuyCredit = useCallback(async () => {
    const pending = usePoints.getState().pendingBuy;
    if (!pending || busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(pending.signature ? 'Verifying the confirmed Solana transfer…' : 'Looking for your payment on Solana…');
    const landed: { slot?: number } = {};
    try {
      // Finishing never pays: it re-reports a signature or has the server look on chain.
      await settle(await resumePurchase(pending, purchaseDeps(wallet?.address ?? '', 'embedded', landed)), landed);
    } catch (caught) {
      setError(friendlyError(caught));
      setNotice(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [busy, purchaseDeps, settle, wallet?.address]);

  const buy = useCallback(async () => {
    if (!quote || busy || inFlight.current) return;
    if (paymentProblem) {
      setError(PAYMENT_WALLET_PROBLEM[paymentProblem]);
      return;
    }
    const external = quote.paymentWallet?.kind === 'external';
    const signer = external ? quote.paymentWallet?.address : wallet?.address;
    if (external && !mwaSupported) {
      // Never quietly paid from the embedded wallet instead.
      setError(
        `Purchases are paid from your external wallet ${shortAddress(signer ?? '')}, which connects only in the Android app. ` +
          'Nothing was charged.',
      );
      return;
    }
    if (!signer) return;
    // The treasury account already exists, so only the payer's side of the rent
    // rule can bite: paying must not leave dust below the rent-exempt minimum.
    const shortfall =
      solBalance === null
        ? null
        : transferShortfall({
            balance: solBalance,
            lamports: quote.lamports,
            rentExemptMinimum: rentExemptMinimum ?? 0,
          });
    if (shortfall) {
      const needed = quote.lamports + SOL_TRANSFER_FEE_LAMPORTS + (rentExemptMinimum ?? 0);
      Alert.alert(
        'Add SOL first',
        shortfall.kind === 'sender-rent'
          ? `Paying ${quote.sol} SOL would leave less than the ${formatLamports(rentExemptMinimum ?? 0)} SOL ` +
              `Solana requires to stay in a wallet. Top up to at least ${formatLamports(needed)} SOL.`
          : `You need ${quote.sol} SOL plus a small network fee in ${external ? 'your external wallet' : 'your embedded wallet'}.`,
        external
          ? [{ text: 'OK', style: 'cancel' }]
          : [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open wallet', onPress: () => router.push('/wallet') },
            ],
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice('Placing your order with the game server…');
    const landed: { slot?: number } = {};
    try {
      await settle(await buyPoints(purchaseDeps(signer, external ? 'external' : 'embedded', landed)), landed);
    } catch (caught) {
      setError(friendlyError(caught));
      setNotice(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [busy, paymentProblem, purchaseDeps, quote, rentExemptMinimum, router, settle, solBalance, wallet]);

  const sell = useCallback(async () => {
    if (!quote || busy || inFlight.current) return;
    const destination = walletPhrase(quote.paymentWallet, wallet?.address);
    const execute = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      const requestId = usePoints.getState().pendingSellId ?? randomUuid();
      usePoints.getState().setPendingSell(requestId);
      setBusy(true);
      setError(null);
      setNotice('Reserving points and preparing the treasury payout…');
      try {
        const result = await requestPointSell(requestId);
        usePoints.getState().sync(result.balance);
        // The server's word on where this sale pays — fixed when it was first
        // made, so a retry after a wallet switch still names the original.
        const paidTo = result.destination ? `${shortAddress(result.destination)}` : destination;
        if (result.status === 'pending') {
          setNotice(`Payout to ${paidTo} broadcast. Tap “Check payout” if it does not confirm shortly.`);
        } else {
          usePoints.getState().setPendingSell(null);
          setNotice(
            result.status === 'confirmed'
              ? `${quote.sol} SOL was sent to ${paidTo}.`
              : 'The payout could not complete, so all reserved points were restored.',
          );
          await refresh({ previousBalance: result.status === 'confirmed' ? solBalance : null });
        }
      } catch (caught) {
        if (/insufficient points|payment wallet|not verified/i.test(caught instanceof Error ? caught.message : String(caught))) {
          usePoints.getState().setPendingSell(null);
        }
        setError(friendlyError(caught));
        setNotice(null);
      } finally {
        inFlight.current = false;
        setBusy(false);
        void loadHistory();
      }
    };
    if (pendingSellId) {
      void execute();
      return;
    }
    if (paymentProblem) {
      setError(PAYMENT_WALLET_PROBLEM[paymentProblem]);
      return;
    }
    const sellable = sellableOf(quote);
    if (sellable < quote.points) {
      Alert.alert(
        'Not enough points to sell',
        balance >= quote.points
          ? `Welcome points are for playing, not for exchange. You can sell ${sellable} of your ${balance} points; a sale takes ${quote.points}.`
          : `You need ${quote.points} points to make this exchange.`,
      );
      return;
    }
    const confirmation = saleConfirmation(quote, quote.paymentWallet, wallet?.address ?? null);
    if (!confirmation) {
      setError(PAYMENT_WALLET_PROBLEM.no_payment_wallet);
      return;
    }
    Alert.alert(confirmation.title, confirmation.body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm sale', onPress: () => void execute() },
    ]);
  }, [balance, busy, loadHistory, paymentProblem, pendingSellId, quote, refresh, solBalance, wallet?.address]);

  const buyLabel = pendingBuy ? (busy ? 'Verifying…' : 'Finish credit') : busy ? 'Processing…' : 'Pay 0.001 SOL';
  const sellLabel = busy ? 'Processing…' : pendingSellId ? 'Check payout' : 'Exchange for SOL';
  const canPay =
    !paymentProblem && (payingExternal ? mwaSupported && Boolean(quote?.paymentWallet?.address) : Boolean(wallet));
  const canBePaid = Boolean(quote?.paymentWallet?.address ?? wallet) && !paymentProblem;
  const statusText =
    error ??
    notice ??
    (paymentProblem
      ? PAYMENT_WALLET_PROBLEM[paymentProblem]
      : payingExternal && !mwaSupported
        ? 'Your payment wallet is external: buy from the Android app, or choose your game wallet.'
        : payingAddress
          ? 'Treasury-backed · server verified · replay protected'
          : 'Waiting for your Privy wallet…');
  const network = quote?.network && quote.network !== 'unknown' ? quote.network : config.cluster;

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
        <Text
          style={styles.solReadout}
          numberOfLines={1}
          accessibilityLabel={
            payingAddress
              ? `Paying wallet: ${payingExternal ? 'external wallet' : 'game wallet'} ${payingAddress}, ` +
                `balance ${solBalance === null ? 'unknown' : `${(solBalance / 1_000_000_000).toFixed(6)} SOL`}`
              : undefined
          }
        >
          {payingAddress ? `${payingExternal ? 'External' : 'Game'} wallet ${shortAddress(payingAddress)}: ` : 'Wallet: '}
          {solBalance === null ? '—' : `${(solBalance / 1_000_000_000).toFixed(6)} SOL`}
        </Text>
        <View style={styles.networkRow}>
          <Text style={styles.networkReadout}>Solana {network} ·</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Manage wallets: link a wallet or choose which one pays"
            hitSlop={10}
            disabled={busy}
            onPress={() => router.push('/wallets' as Href)}
          >
            <Text style={styles.manageLink}>Manage wallets</Text>
          </Pressable>
        </View>
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
          {TABS.map((item) => (
            <ArtPlate
              key={item.id}
              tone={tab === item.id ? 'green' : 'cream'}
              w={124}
              h={36}
              fontSize={15}
              label={item.label}
              accessibilityLabel={`${item.label}${tab === item.id ? ', selected' : ''}`}
              onPress={() => {
                setTab(item.id);
                if (item.id === 'history') void loadHistory();
              }}
            />
          ))}
        </View>

        {tab === 'history' ? (
          <View style={styles.history}>
            {history === null ? (
              <Text style={styles.copy}>Your exchanges will be listed here.</Text>
            ) : history.trades.length === 0 ? (
              <Text style={styles.copy}>No exchanges yet.</Text>
            ) : (
              history.trades.slice(0, 5).map((trade) => {
                const line = tradeLine(trade, Date.now());
                const url = tradeExplorerUrl(trade, history.network);
                return (
                  <View key={trade.requestId} style={styles.historyRow}>
                    <Text style={styles.historyKind} numberOfLines={1}>
                      {trade.kind === 'buy' ? 'Bought' : 'Sold'} {trade.points} pts
                    </Text>
                    <Text
                      style={[
                        styles.historyStatus,
                        line.tone === 'done' ? styles.toneDone : line.tone === 'failed' ? styles.toneFailed : styles.tonePending,
                      ]}
                      numberOfLines={1}
                    >
                      {line.label}
                    </Text>
                    <Text style={styles.historyDate} numberOfLines={1}>
                      {new Date(trade.createdAt).toLocaleDateString()}
                    </Text>
                    {url ? (
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={`View ${trade.kind === 'buy' ? 'purchase' : 'payout'} on Solana Explorer`}
                        hitSlop={8}
                        onPress={() => void Linking.openURL(url)}
                        style={styles.historyLinkBox}
                      >
                        <Text style={styles.historyLink}>View</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.historyLinkBox} />
                    )}
                  </View>
                );
              })
            )}
          </View>
        ) : loading && !quote ? (
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
                ? `Pays 0.001 SOL from ${walletPhrase(quote?.paymentWallet, wallet?.address)} on ${network}. Points are credited only after the server verifies the transfer on Solana.`
                : `Sells 100 points for 0.001 SOL from the treasury, paid to ${walletPhrase(quote?.paymentWallet, wallet?.address)}. Welcome points are play-only: you can sell ${quote ? sellableOf(quote) : 0} now.`}
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
                  disabled={busy || (!pendingBuy && (!canPay || !quote))}
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
                  disabled={busy || !quote || (!pendingSellId && !canBePaid)}
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
  networkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  networkReadout: { color: artColor.soft, fontFamily: font.body, fontSize: 11 },
  manageLink: { color: artColor.ink, fontFamily: font.label, fontSize: 11, textDecorationLine: 'underline' },
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
  history: { flex: 1, paddingTop: 8, gap: 2 },
  historyRow: { flexDirection: 'row', alignItems: 'center', minHeight: 30, gap: 6 },
  historyKind: { width: 104, color: artColor.navy, fontFamily: font.label, fontSize: 13 },
  historyStatus: { flex: 1, fontFamily: font.body, fontSize: 12.5 },
  historyDate: { width: 70, color: artColor.soft, fontFamily: font.body, fontSize: 11.5, textAlign: 'right' },
  historyLinkBox: { width: 44, minHeight: 30, alignItems: 'center', justifyContent: 'center' },
  historyLink: { color: artColor.ink, fontFamily: font.display, fontSize: 13, textDecorationLine: 'underline' },
  toneDone: { color: artColor.green },
  tonePending: { color: artColor.soft },
  toneFailed: { color: color.inkRed },
  status: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  shield: { width: 15, height: 17 },
  statusText: { flexShrink: 1, color: artColor.green, fontFamily: font.body, fontSize: 12, textAlign: 'center' },
  error: { color: color.inkRed },
});
