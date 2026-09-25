import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type ConfirmedSignatureInfo,
} from '@solana/web3.js';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';

import { BACKGROUNDS } from '@/ui/assets';
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { InkTextInput } from '@/ui/InkTextInput';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { color, font, space, type as typeScale } from '@/ui/tokens';
import {
  explorerAddressUrl,
  explorerTransactionUrl,
  parseSolToLamports,
  readBalanceAtLeastSlot,
  shortAddress,
  solanaConfig,
} from '@/wallet/solana';

type WalletTab = 'receive' | 'send' | 'activity';
const FEE_RESERVE_LAMPORTS = 10_000n;

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel|reject|declin/i.test(message)) return 'The wallet request was cancelled.';
  if (/insufficient|fund/i.test(message)) return 'This wallet does not have enough SOL.';
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
    if (balance !== null && lamports + FEE_RESERVE_LAMPORTS > BigInt(balance)) {
      setError('Not enough SOL after reserving the network fee.');
      return;
    }

    setActionBusy(true);
    try {
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
  const walletStatus = walletState.status.replace('-', ' ');

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <View style={styles.back}>
        <InkIconButton
          icon="back"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
        />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title="Captain’s wallet" w={310} h={42} size="md" />
      </View>

      <View style={styles.summary}>
        <InkPanel w={290} h={274} seedKey="wallet-summary" padding={space.sm}>
          <Text style={styles.kicker}>Privy embedded Solana wallet</Text>
          <Text style={styles.statusLabel}>Status: {walletStatus}</Text>
          {wallet ? (
            <>
              <Text style={styles.balanceLabel}>Available balance</Text>
              <Text style={styles.balance}>
                {balance === null ? '—' : (balance / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL
              </Text>
              <Text style={styles.address} selectable>{shortAddress(address, 10)}</Text>
              <View style={styles.twoButtons}>
                <InkButton label="Copy" w={116} h={36} size="sm" onPress={() => void copyAddress()} />
                <InkButton label="Explorer" w={116} h={36} size="sm" onPress={() => void Linking.openURL(explorerAddressUrl(address, config.cluster))} />
              </View>
              <View style={styles.twoButtons}>
                <InkButton label={loading ? 'Refreshing…' : 'Refresh'} w={116} h={36} size="sm" disabled={loading} onPress={() => void refresh()} />
                <InkButton label={actionBusy ? 'Signing…' : 'Sign proof'} w={116} h={36} size="sm" disabled={actionBusy} onPress={() => void signProof()} />
              </View>
            </>
          ) : (
            <View style={styles.walletWait}>
              <InkSpinner size={30} seedKey="wallet-create" />
              <Text style={styles.helper}>
                {walletState.status === 'error'
                  ? walletState.error
                  : walletState.status === 'needs-recovery'
                    ? 'Your wallet needs recovery before it can sign.'
                    : 'Privy is preparing your wallet.'}
              </Text>
              {walletState.status === 'not-created' && walletState.create ? (
                <InkButton label="Create wallet" w={170} h={38} size="sm" onPress={() => void walletState.create?.()} />
              ) : null}
              {walletState.status === 'needs-recovery' ? (
                <InkButton label="Recover wallet" w={170} h={38} size="sm" onPress={() => void walletState.recover()} />
              ) : null}
            </View>
          )}
        </InkPanel>
      </View>

      <View style={styles.detail}>
        <InkPanel w={450} h={274} seedKey="wallet-detail" padding={space.sm}>
          <View style={styles.tabs}>
            {(['receive', 'send', 'activity'] as const).map((item) => (
              <InkButton
                key={item}
                label={item[0]!.toUpperCase() + item.slice(1)}
                tone={tab === item ? 'confirm' : 'ink'}
                w={132}
                h={34}
                size="sm"
                disabled={walletUnavailable}
                onPress={() => { setTab(item); setError(null); setNotice(null); }}
              />
            ))}
          </View>

          {wallet ? (
            <View style={styles.tabBody}>
              {tab === 'receive' ? (
                <View style={styles.receive}>
                  <View style={styles.qr}>
                    <QRCodeStyled
                      data={address}
                      pieceSize={3}
                      pieceScale={1.02}
                      pieceCornerType="cut"
                      color={color.ink}
                      padding={6}
                      backgroundColor={color.paper}
                    />
                  </View>
                  <View style={styles.receiveCopy}>
                    <Text style={styles.sectionTitle}>Receive SOL</Text>
                    <Text style={styles.helper}>Share this QR or the address below. Only send Solana assets to this wallet.</Text>
                    <Text style={styles.fullAddress} selectable>{address}</Text>
                    <InkButton label="Copy address" w={176} h={38} size="sm" onPress={() => void copyAddress()} />
                  </View>
                </View>
              ) : tab === 'send' ? (
                <View style={styles.sendForm}>
                  <Text style={styles.sectionTitle}>Send SOL</Text>
                  <Text style={styles.fieldLabel}>Recipient</Text>
                  <InkTextInput value={recipient} onChangeText={setRecipient} placeholder="Solana address" seedKey="wallet-recipient" w={400} h={39} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Recipient Solana address" />
                  <View style={styles.amountRow}>
                    <View>
                      <Text style={styles.fieldLabel}>Amount</Text>
                      <InkTextInput value={amount} onChangeText={setAmount} placeholder="0.00 SOL" seedKey="wallet-amount" w={210} h={39} inputMode="decimal" keyboardType="decimal-pad" accessibilityLabel="SOL amount" />
                    </View>
                    <InkButton label={actionBusy ? 'Sending…' : 'Review & send'} tone="confirm" w={176} h={42} size="sm" disabled={actionBusy || !recipient.trim() || !amount.trim()} onPress={() => void send()} />
                  </View>
                </View>
              ) : (
                <View style={styles.activity}>
                  <Text style={styles.sectionTitle}>Recent activity</Text>
                  {loading && activity.length === 0 ? (
                    <View style={styles.loadingRow}><InkSpinner size={20} /><Text style={styles.helper}>Reading Solana…</Text></View>
                  ) : activity.length === 0 ? (
                    <Text style={styles.helper}>No recent transactions were found for this address.</Text>
                  ) : (
                    activity.map((item) => (
                      <InkButton
                        key={item.signature}
                        label={`${item.err ? 'Failed' : 'Confirmed'}  ${shortAddress(item.signature, 9)}`}
                        tone={item.err ? 'danger' : 'ink'}
                        w={400}
                        h={31}
                        size="sm"
                        onPress={() => void Linking.openURL(explorerTransactionUrl(item.signature, config.cluster))}
                      />
                    ))
                  )}
                </View>
              )}
            </View>
          ) : null}

          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Text style={[styles.noticeText, error ? styles.error : null]} numberOfLines={2}>
              {error ?? notice ?? `Network: ${config.cluster}`}
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
  summary: { position: 'absolute', left: 24, top: 70 },
  detail: { position: 'absolute', left: 326, top: 70 },
  kicker: { color: color.ink, fontFamily: font.label, fontSize: typeScale.sm, textAlign: 'center' },
  statusLabel: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs, textAlign: 'center', marginTop: 3 },
  balanceLabel: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs, textAlign: 'center', marginTop: space.sm },
  balance: { color: color.inkGreen, fontFamily: font.display, fontSize: typeScale.lg, textAlign: 'center', marginTop: 2 },
  address: { color: color.ink, fontFamily: font.body, fontSize: typeScale.xs, textAlign: 'center', marginVertical: space.sm },
  twoButtons: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 2 },
  walletWait: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  tabs: { flexDirection: 'row', justifyContent: 'space-between' },
  tabBody: { flex: 1, marginTop: space.xs },
  receive: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  qr: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  receiveCopy: { flex: 1, gap: space.xs, alignItems: 'flex-start' },
  sectionTitle: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  helper: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs, lineHeight: 18, textAlign: 'center' },
  fullAddress: { color: color.ink, fontFamily: font.body, fontSize: typeScale.xxs, lineHeight: 15 },
  sendForm: { flex: 1, gap: 3 },
  fieldLabel: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.xxs, marginTop: 2 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 3 },
  activity: { flex: 1, gap: 2 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, marginTop: space.lg },
  notice: { position: 'absolute', left: 18, right: 18, bottom: 7, alignItems: 'center' },
  noticeText: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs, textAlign: 'center' },
  error: { color: color.inkRed },
});
