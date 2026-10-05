/**
 * Captain's wallet — drawn to its mockup on BACKGROUNDS.settings with
 * WALLET_ART: the Privy embedded wallet on the left (status, balance, address,
 * Copy / Explorer / Refresh / Sign proof), Receive / Send / Activity on the
 * right. Text is live throughout; the art only carries labels that never
 * change. The network line doubles as the place errors and notices appear.
 */
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type ConfirmedSignatureInfo,
} from '@solana/web3.js';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';

import {
  ActivityGlyph,
  ActivityRow,
  LabelledArtButton,
  NetworkFooter,
  PlateButton,
  QrSparkles,
  ReceiveGlyph,
  Sparkles,
  WALLET_BLUE,
  WALLET_GREEN,
  WALLET_INK,
} from '@/features/wallet/WalletParts';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { BACKGROUNDS, PROFILE_ART, SETTINGS_ART, WALLET_ART } from '@/ui/assets';
import { InkSpinner } from '@/ui/InkSpinner';
import { Scale } from '@/ui/Scale';
import { CANVAS_W, color, font } from '@/ui/tokens';
import {
  explorerAddressUrl,
  explorerTransactionUrl,
  formatLamports,
  isRentError,
  parseSolToLamports,
  readBalanceAtLeastSlot,
  shortAddress,
  solanaConfig,
  transferShortfall,
} from '@/wallet/solana';

type WalletTab = 'receive' | 'send' | 'activity';

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel|reject|declin/i.test(message)) return 'The wallet request was cancelled.';
  if (isRentError(message)) {
    return 'Solana needs a small minimum (about 0.00065 SOL) left in each wallet. Lower the amount.';
  }
  if (/insufficient (funds|lamports)|attempt to debit/i.test(message)) {
    return 'This wallet does not have enough SOL.';
  }
  if (/blockhash|expired/i.test(message)) return 'The transaction expired. Please try again.';
  if (/network|fetch|timeout/i.test(message)) return 'The Solana network could not be reached.';
  return message.length < 110 ? message : 'The wallet request failed. Please try again.';
}

export default function WalletScreen() {
  const router = useRouter();
  const walletState = useEmbeddedSolanaWallet();
  const wallet = walletState.wallets?.[0];
  const address = wallet?.address ?? '';
  const config = useMemo(solanaConfig, []);
  const connection = useMemo(() => new Connection(config.rpcUrl, 'confirmed'), [config.rpcUrl]);
  const [tab, setTab] = useState<WalletTab>('receive');
  const [balance, setBalance] = useState<number | null>(null);
  const [activity, setActivity] = useState<ConfirmedSignatureInfo[]>([]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (after?: { minContextSlot?: number; previousBalance?: number | null }) => {
      if (!address) return;
      setLoading(true);
      setError(null);
      try {
        const publicKey = new PublicKey(address);
        const [nextBalance, signatures] = await Promise.all([
          // After a send this waits for a node that has actually seen the
          // transaction, instead of trusting whichever replica answers first.
          readBalanceAtLeastSlot(connection, publicKey, {
            minContextSlot: after?.minContextSlot,
            differentFrom: after?.previousBalance ?? null,
          }),
          connection.getSignaturesForAddress(publicKey, { limit: 5 }, 'confirmed'),
        ]);
        setBalance(nextBalance);
        setActivity(signatures);
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        setLoading(false);
      }
    },
    [address, connection],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setError(null);
    setNotice('Wallet address copied.');
  }, [address]);

  const signProof = useCallback(async () => {
    if (!wallet || actionBusy) return;
    setActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      const provider = await wallet.getProvider();
      await provider.request({
        method: 'signMessage',
        params: { message: `Empire of Bits wallet proof\n${new Date().toISOString()}` },
      });
      setNotice('Wallet proof signed successfully.');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, wallet]);

  const send = useCallback(async () => {
    if (!wallet || actionBusy) return;
    setError(null);
    setNotice(null);
    let destination: PublicKey;
    try {
      destination = new PublicKey(recipient.trim());
    } catch {
      setError('Enter a valid Solana address.');
      return;
    }
    const lamports = parseSolToLamports(amount);
    if (lamports === null) {
      setError('Enter a positive SOL amount with at most 9 decimal places.');
      return;
    }

    setActionBusy(true);
    try {
      if (balance !== null) {
        const [rentExemptMinimum, recipientBalance] = await Promise.all([
          connection.getMinimumBalanceForRentExemption(0, 'confirmed'),
          connection.getBalance(destination, 'confirmed'),
        ]);
        const shortfall = transferShortfall({
          balance,
          lamports: Number(lamports),
          rentExemptMinimum,
          recipientBalance,
        });
        if (shortfall?.kind === 'balance') {
          setError(`Not enough SOL. After the network fee you can send up to ${formatLamports(shortfall.maxLamports)} SOL.`);
          return;
        }
        if (shortfall?.kind === 'sender-rent') {
          setError(
            `Solana must keep ${formatLamports(rentExemptMinimum)} SOL in the wallet. Send up to ` +
              `${formatLamports(shortfall.maxLamports)} SOL, or exactly ${formatLamports(shortfall.emptyLamports)} to empty it.`,
          );
          return;
        }
        if (shortfall?.kind === 'recipient-rent') {
          setError(`That address is new on Solana, so it must receive at least ${formatLamports(shortfall.minLamports)} SOL.`);
          return;
        }
      }
      const latest = await connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction({
        feePayer: new PublicKey(wallet.address),
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }).add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(wallet.address),
          toPubkey: destination,
          lamports,
        }),
      );
      const provider = await wallet.getProvider();
      const result = await provider.request({
        method: 'signAndSendTransaction',
        params: { transaction, connection, options: { preflightCommitment: 'confirmed' } },
      });
      const confirmation = await connection.confirmTransaction(
        { signature: result.signature, ...latest },
        'confirmed',
      );
      if (confirmation.value.err) throw new Error('The Solana transaction was not confirmed.');
      setRecipient('');
      setAmount('');
      setNotice(`Sent successfully: ${shortAddress(result.signature, 7)}`);
      setTab('activity');
      await refresh({
        minContextSlot: confirmation.context?.slot,
        previousBalance: balance,
      });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, amount, balance, connection, recipient, refresh, wallet]);

  const walletUnavailable = !wallet;
  const connected = walletState.status === 'connected';
  const walletStatus = walletState.status.replace('-', ' ');
  const pickTab = (item: WalletTab) => {
    setTab(item);
    setError(null);
    setNotice(null);
  };
  const pasteRecipient = async () => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (text) setRecipient(text);
  };

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <ArtImageButton
        source={SETTINGS_ART.back}
        w={72}
        h={44}
        label="Back"
        style={styles.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
      <View style={styles.banner} pointerEvents="none" accessibilityRole="header">
        <Image source={WALLET_ART.banner} style={StyleSheet.absoluteFill} contentFit="fill" />
        <Text style={styles.bannerText}>Captain’s wallet</Text>
      </View>

      {/* ---- The wallet ---- */}
      <View style={[styles.panel, { left: LEFT.x, width: LEFT.w }]}>
        <Image source={WALLET_ART.panelLeft} style={StyleSheet.absoluteFill} contentFit="fill" />
        <Text style={styles.kicker}>Privy embedded Solana wallet</Text>
        <View style={styles.statusRow}>
          <Image
            source={WALLET_ART.iconDot}
            style={styles.statusDot}
            contentFit="contain"
            tintColor={
              connected ? undefined : walletState.status === 'error' ? color.inkRed : '#C9A227'
            }
          />
          <Text style={styles.statusText}>Status: {walletStatus}</Text>
        </View>
        <Image
          source={PROFILE_ART.titleUnderline}
          style={[styles.rule, { top: 66 }]}
          contentFit="fill"
        />
        {wallet ? (
          <>
            <Text style={styles.balanceLabel}>Available balance</Text>
            <View style={styles.balanceBox}>
              <Sparkles w={LEFT.w - 40} h={44} />
              <Text
                style={styles.balance}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {balance === null
                  ? loading
                    ? '…'
                    : '—'
                  : (balance / 1_000_000_000).toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}{' '}
                SOL
              </Text>
            </View>
            <Pressable
              style={styles.addressRow}
              onPress={() => void copyAddress()}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Wallet address ${address}. Copy`}
            >
              <Text style={styles.address}>{shortAddress(address, 10)}</Text>
              <Image
                source={WALLET_ART.iconAddressCopy}
                style={styles.addressCopy}
                contentFit="contain"
              />
            </Pressable>
            <Image
              source={PROFILE_ART.titleUnderline}
              style={[styles.rule, { top: 166 }]}
              contentFit="fill"
            />
            <View style={styles.grid}>
              <LabelledArtButton
                source={WALLET_ART.btnCopy}
                w={BTN.w}
                h={BTN.h}
                label="Copy address"
                onPress={() => void copyAddress()}
              />
              <LabelledArtButton
                source={WALLET_ART.btnExplorer}
                w={BTN.w}
                h={BTN.h}
                label="Open in explorer"
                onPress={() => void Linking.openURL(explorerAddressUrl(address, config.cluster))}
              />
              <LabelledArtButton
                source={WALLET_ART.btnRefresh}
                w={BTN.w}
                h={BTN.h}
                label="Refresh balance"
                busy={loading}
                onPress={() => void refresh()}
              />
              <LabelledArtButton
                source={WALLET_ART.btnSign}
                w={BTN.w}
                h={BTN.h}
                label="Sign proof"
                busy={actionBusy && tab !== 'send'}
                disabled={actionBusy}
                onPress={() => void signProof()}
              />
            </View>
          </>
        ) : (
          <View style={styles.walletWait}>
            <InkSpinner size={30} seedKey="wallet-create" stroke={WALLET_INK} />
            <Text style={styles.helper}>
              {walletState.status === 'error'
                ? walletState.error
                : walletState.status === 'needs-recovery'
                  ? 'Your wallet needs recovery before it can sign.'
                  : 'Privy is preparing your wallet.'}
            </Text>
            {walletState.status === 'not-created' && walletState.create ? (
              <PlateButton
                plate={WALLET_ART.tabOn}
                w={170}
                h={49}
                label="Create wallet"
                onPress={() => void walletState.create?.()}
              />
            ) : null}
            {walletState.status === 'needs-recovery' ? (
              <PlateButton
                plate={WALLET_ART.tabOn}
                w={170}
                h={49}
                label="Recover wallet"
                onPress={() => void walletState.recover()}
              />
            ) : null}
          </View>
        )}
      </View>

      {/* ---- Receive / Send / Activity ---- */}
      <View style={[styles.panel, { left: RIGHT.x, width: RIGHT.w }]}>
        <Image source={WALLET_ART.panelRight} style={StyleSheet.absoluteFill} contentFit="fill" />
        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map((item) => (
            <PlateButton
              key={item.id}
              plate={tab === item.id ? WALLET_ART.tabOn : WALLET_ART.tab}
              w={TAB.w}
              h={TAB.h}
              label={item.label}
              selected={tab === item.id}
              disabled={walletUnavailable}
              icon={
                item.id === 'receive' ? (
                  <ReceiveGlyph />
                ) : item.id === 'send' ? (
                  <Image source={WALLET_ART.iconSend} style={styles.tabIcon} contentFit="contain" />
                ) : (
                  <ActivityGlyph />
                )
              }
              onPress={() => pickTab(item.id)}
            />
          ))}
        </View>
        <Image source={PROFILE_ART.titleUnderline} style={styles.tabRule} contentFit="fill" />

        {wallet ? (
          tab === 'receive' ? (
            <>
              <Image
                source={WALLET_ART.headingReceive}
                style={styles.headingReceive}
                contentFit="contain"
                accessibilityRole="header"
                accessibilityLabel="Receive SOL"
              />
              <View style={styles.qrMarks}>
                <QrSparkles size={112} />
              </View>
              <View style={styles.qr}>
                <QRCodeStyled
                  data={address}
                  pieceSize={3.4}
                  pieceScale={1.02}
                  pieceCornerType="cut"
                  color="#2A2FA6"
                  padding={5}
                  backgroundColor="#FFFFFF"
                />
              </View>
              <Text style={styles.instructions}>
                Share this QR or the address below. Only send Solana assets to this wallet.
              </Text>
              <Text style={styles.fullAddress} selectable>
                {address}
              </Text>
              <View style={styles.copyAddress}>
                <LabelledArtButton
                  source={WALLET_ART.btnCopyAddress}
                  w={206}
                  h={37}
                  label="Copy address"
                  onPress={() => void copyAddress()}
                />
              </View>
            </>
          ) : tab === 'send' ? (
            <>
              <Image
                source={WALLET_ART.headingSend}
                style={styles.headingSend}
                contentFit="contain"
                accessibilityRole="header"
                accessibilityLabel="Send SOL"
              />
              <Text style={[styles.fieldLabel, { top: 99 }]}>Recipient</Text>
              <View style={[styles.field, { top: 117, width: FIELD.recipientW }]}>
                <Image
                  source={WALLET_ART.fieldRecipient}
                  style={StyleSheet.absoluteFill}
                  contentFit="fill"
                />
                <TextInput
                  value={recipient}
                  onChangeText={setRecipient}
                  placeholder="Solana address"
                  placeholderTextColor="#8C93B8"
                  style={[styles.input, { right: 50 }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Recipient Solana address"
                />
                <Pressable
                  onPress={() => void pasteRecipient()}
                  hitSlop={8}
                  style={styles.paste}
                  accessibilityRole="button"
                  accessibilityLabel="Paste address"
                >
                  <Image
                    source={WALLET_ART.iconCopy}
                    style={styles.pasteIcon}
                    contentFit="contain"
                  />
                </Pressable>
              </View>
              <Text style={[styles.fieldLabel, { top: 163 }]}>Amount</Text>
              <View style={[styles.field, { top: 181, width: FIELD.amountW }]}>
                <Image
                  source={WALLET_ART.fieldAmount}
                  style={StyleSheet.absoluteFill}
                  contentFit="fill"
                />
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00 SOL"
                  placeholderTextColor="#8C93B8"
                  style={[styles.input, { right: 12 }]}
                  inputMode="decimal"
                  keyboardType="decimal-pad"
                  accessibilityLabel="SOL amount"
                />
              </View>
              <View style={styles.sendButton}>
                <PlateButton
                  plate={WALLET_ART.sendButton}
                  w={SEND.w}
                  h={SEND.h}
                  label={actionBusy ? 'Sending…' : 'Review & send'}
                  busy={actionBusy}
                  disabled={!recipient.trim() || !amount.trim()}
                  icon={
                    <Image
                      source={WALLET_ART.iconSend}
                      style={styles.tabIcon}
                      contentFit="contain"
                    />
                  }
                  onPress={() => void send()}
                />
              </View>
            </>
          ) : (
            <>
              <Image
                source={WALLET_ART.headingActivity}
                style={styles.headingActivity}
                contentFit="contain"
                accessibilityRole="header"
                accessibilityLabel="Recent activity"
              />
              <View style={styles.rows}>
                {loading && activity.length === 0 ? (
                  <View style={styles.loadingRow}>
                    <InkSpinner size={20} stroke={WALLET_INK} />
                    <Text style={styles.helper}>Reading Solana…</Text>
                  </View>
                ) : activity.length === 0 ? (
                  <Text style={[styles.helper, styles.empty]}>
                    No recent transactions were found for this address.
                  </Text>
                ) : (
                  activity.map((item) => (
                    <ActivityRow
                      key={item.signature}
                      w={ROW.w}
                      h={ROW.h}
                      failed={item.err !== null}
                      signature={shortAddress(item.signature, 9)}
                      onPress={() =>
                        void Linking.openURL(explorerTransactionUrl(item.signature, config.cluster))
                      }
                    />
                  ))
                )}
              </View>
            </>
          )
        ) : (
          <Text style={[styles.helper, styles.empty]}>
            The wallet opens once Privy has it ready.
          </Text>
        )}

        <View style={styles.footer}>
          <NetworkFooter
            text={error ?? notice ?? `Network: ${networkName(config.cluster)}`}
            tone={error ? 'error' : notice ? 'notice' : 'plain'}
          />
        </View>
      </View>
    </Scale>
  );
}

/** Canvas layout (800 x 360). scripts/wallet-assets.sh builds each plate at 3x these sizes. */
const PANEL_Y = 62;
const PANEL_H = 290;
const LEFT = { x: 20, w: 318 } as const;
const RIGHT = { x: 350, w: 430 } as const;
const BTN = { w: 136, h: 136 * (121 / 420) } as const;
const TAB = { w: 124, h: 124 * (111 / 384) } as const;
const SEND = { w: 180, h: 40 } as const;
const FIELD = { recipientW: 390, amountW: 196, h: 37.5 } as const;
const ROW = { w: 390, h: 28 } as const;
const TABS: readonly { id: WalletTab; label: string }[] = [
  { id: 'receive', label: 'Receive' },
  { id: 'send', label: 'Send' },
  { id: 'activity', label: 'Activity' },
];

/** The cluster as the mockup names it. */
function networkName(cluster: string): string {
  return cluster === 'mainnet' ? 'mainnet-beta' : cluster;
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
  panel: { position: 'absolute', top: PANEL_Y, height: PANEL_H },
  kicker: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 18,
    color: WALLET_INK,
    fontFamily: font.display,
    fontSize: 17,
    textAlign: 'center',
  },
  statusRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  statusDot: { width: 10, height: 10 },
  statusText: { color: WALLET_BLUE, fontFamily: font.body, fontSize: 12.5 },
  rule: { position: 'absolute', left: 44, right: 44, height: 5, opacity: 0.55 },
  balanceLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 76,
    color: WALLET_INK,
    fontFamily: font.label,
    fontSize: 14.5,
    textAlign: 'center',
  },
  balanceBox: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 95,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  balance: { color: WALLET_GREEN, fontFamily: font.display, fontSize: 31 },
  addressRow: {
    position: 'absolute',
    alignSelf: 'center',
    top: 141,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  address: { color: WALLET_INK, fontFamily: font.label, fontSize: 13.5 },
  addressCopy: { width: 13, height: 15 },
  grid: {
    position: 'absolute',
    left: (LEFT.w - BTN.w * 2 - 10) / 2,
    top: 180,
    width: BTN.w * 2 + 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    columnGap: 10,
  },
  walletWait: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: 80,
    bottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  helper: {
    color: WALLET_BLUE,
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: 'center',
  },
  tabs: {
    position: 'absolute',
    left: (RIGHT.w - TAB.w * 3 - 18) / 2,
    top: 16,
    flexDirection: 'row',
    gap: 9,
  },
  tabIcon: { width: 17, height: 17 },
  tabRule: { position: 'absolute', left: 22, right: 22, top: 58, height: 5, opacity: 0.5 },
  headingReceive: {
    position: 'absolute',
    left: 18,
    top: 63,
    width: 124,
    height: 124 * (105 / 420),
  },
  headingSend: { position: 'absolute', left: 20, top: 66, width: 108, height: 108 * (96 / 401) },
  headingActivity: {
    position: 'absolute',
    left: 20,
    top: 65,
    width: 150,
    height: 150 * (83 / 480),
  },
  qr: {
    position: 'absolute',
    left: 24,
    top: 99,
    width: 112,
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  qrMarks: { position: 'absolute', left: 24 - 12, top: 99 - 12 },
  instructions: {
    position: 'absolute',
    left: 152,
    right: 18,
    top: 104,
    color: WALLET_BLUE,
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
  },
  fullAddress: {
    position: 'absolute',
    left: 152,
    right: 18,
    top: 160,
    color: WALLET_INK,
    fontFamily: font.body,
    fontSize: 10.5,
    lineHeight: 14,
  },
  copyAddress: { position: 'absolute', left: 150, top: 212 },
  fieldLabel: {
    position: 'absolute',
    left: 22,
    color: WALLET_INK,
    fontFamily: font.label,
    fontSize: 13,
  },
  field: { position: 'absolute', left: 20, height: FIELD.h },
  input: {
    position: 'absolute',
    left: 12,
    top: 0,
    bottom: 0,
    color: WALLET_INK,
    fontFamily: font.body,
    fontSize: 14,
    paddingVertical: 0,
  },
  paste: {
    position: 'absolute',
    right: 14,
    top: (FIELD.h - 22) / 2,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteIcon: { width: 17, height: 19 },
  sendButton: { position: 'absolute', left: 230, top: 180 },
  rows: { position: 'absolute', left: 20, top: 95, gap: 3 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: ROW.w,
    marginTop: 40,
  },
  empty: { position: 'absolute', left: 30, right: 30, top: 130 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' },
});
