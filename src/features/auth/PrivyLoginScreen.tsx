import { useLoginWithEmail, useLoginWithOAuth } from '@privy-io/expo';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { InkTextInput } from '@/ui/InkTextInput';
import { LogoMark } from '@/ui/LogoMark';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { color, font, space, type as typeScale } from '@/ui/tokens';

const RESEND_SECONDS = 30;

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel/i.test(message)) return 'Sign-in was cancelled.';
  if (/network|fetch|offline|timeout/i.test(message)) return 'Check your connection and try again.';
  if (/rate|too many/i.test(message)) return 'Too many attempts. Wait a moment and try again.';
  if (/code|otp/i.test(message)) return 'That code was not accepted. Check it and try again.';
  return message.length <= 120 ? message : 'Sign-in could not be completed. Please try again.';
}

export function PrivyLoginScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const emailLogin = useLoginWithEmail();
  const oauth = useLoginWithOAuth();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const normalizedEmail = email.trim().toLowerCase();
  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail), [normalizedEmail]);
  const codeValid = /^\d{6}$/.test(code);
  const emailBusy = emailLogin.state.status === 'sending-code' || emailLogin.state.status === 'submitting-code';
  const googleBusy = oauth.state.status === 'loading';
  const busy = emailBusy || googleBusy;

  const sendCode = useCallback(async () => {
    if (!emailValid || emailBusy || cooldown > 0) return;
    setError(null);
    try {
      await emailLogin.sendCode({ email: normalizedEmail });
      setCodeSent(true);
      setCooldown(RESEND_SECONDS);
    } catch (caught) {
      setError(readableError(caught));
    }
  }, [cooldown, emailBusy, emailLogin, emailValid, normalizedEmail]);

  const submitCode = useCallback(async () => {
    if (!codeValid || emailBusy) return;
    setError(null);
    try {
      await emailLogin.loginWithCode({ email: normalizedEmail, code });
    } catch (caught) {
      setError(readableError(caught));
    }
  }, [code, codeValid, emailBusy, emailLogin, normalizedEmail]);

  const loginWithGoogle = useCallback(async () => {
    if (busy) return;
    setError(null);
    try {
      await oauth.login({ provider: 'google', redirectUri: '/' });
    } catch (caught) {
      setError(readableError(caught));
    }
  }, [busy, oauth]);

  const changeEmail = useCallback(() => {
    if (busy) return;
    setCodeSent(false);
    setCode('');
    setCooldown(0);
    setError(null);
  }, [busy]);

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Scale>
        <Paper variant="full" />
        <View style={styles.intro}>
          <LogoMark w={330} h={70} subtitle="Ocean Warfare" />
          <Text style={styles.headline}>Captain’s log-in</Text>
          <Text style={styles.copy}>
            Sign in before setting sail. Your secure Solana wallet is created automatically.
          </Text>
          <Text style={styles.note}>No seed phrase to manage. Privy keeps the signing key protected.</Text>
        </View>

        <View style={styles.form}>
          <InkPanel w={350} h={300} seedKey="privy-login" padding={18}>
            <Text style={styles.formTitle}>Choose your sign-in</Text>
            <InkButton
              label={googleBusy ? 'Opening Google…' : 'Continue with Google'}
              w={306}
              h={42}
              size="sm"
              disabled={busy}
              onPress={() => void loginWithGoogle()}
            />
            <Text style={styles.or}>— or use email + one-time code —</Text>

            <InkTextInput
              value={email}
              onChangeText={setEmail}
              placeholder="captain@example.com"
              seedKey="login-email"
              w={306}
              h={40}
              editable={!busy && !codeSent}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              inputMode="email"
              keyboardType="email-address"
              returnKeyType="send"
              onSubmitEditing={() => void sendCode()}
              accessibilityLabel="Email address"
            />

            {codeSent ? (
              <>
                <View style={styles.codeRow}>
                  <InkTextInput
                    value={code}
                    onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit code"
                    seedKey="login-code"
                    w={168}
                    h={40}
                    editable={!busy}
                    inputMode="numeric"
                    keyboardType="number-pad"
                    maxLength={6}
                    returnKeyType="done"
                    onSubmitEditing={() => void submitCode()}
                    accessibilityLabel="One-time code"
                  />
                  <InkButton
                    label={emailBusy ? 'Checking…' : 'Sign in'}
                    w={128}
                    h={40}
                    size="sm"
                    disabled={!codeValid || busy}
                    onPress={() => void submitCode()}
                  />
                </View>
                <View style={styles.secondaryRow}>
                  <InkButton label="Change email" w={142} h={34} size="sm" disabled={busy} onPress={changeEmail} />
                  <InkButton
                    label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                    w={154}
                    h={34}
                    size="sm"
                    disabled={busy || cooldown > 0}
                    onPress={() => void sendCode()}
                  />
                </View>
              </>
            ) : (
              <InkButton
                label={emailBusy ? 'Sending…' : 'Email me a code'}
                w={306}
                h={40}
                size="sm"
                disabled={!emailValid || busy}
                onPress={() => void sendCode()}
              />
            )}

            <View style={styles.status} accessibilityLiveRegion="polite">
              {busy ? <InkSpinner size={18} seedKey="login-action" /> : null}
              <Text style={[styles.statusText, error ? styles.error : null]} numberOfLines={2}>
                {error ?? (codeSent ? `Code sent to ${normalizedEmail}` : 'Your email is never shown to other players.')}
              </Text>
            </View>
          </InkPanel>
        </View>
      </Scale>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.paper },
  intro: { position: 'absolute', left: 58, top: 58, width: 330, alignItems: 'center' },
  headline: { color: color.ink, fontFamily: font.display, fontSize: typeScale.lg, marginTop: space.md },
  copy: { color: color.ink, fontFamily: font.body, fontSize: typeScale.sm, lineHeight: 22, textAlign: 'center', marginTop: space.sm },
  note: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs, lineHeight: 16, textAlign: 'center', marginTop: space.sm },
  form: { position: 'absolute', left: 420, top: 42 },
  formTitle: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md, textAlign: 'center', marginBottom: space.sm },
  or: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs, textAlign: 'center', marginVertical: 5 },
  codeRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  secondaryRow: { flexDirection: 'row', gap: 10, marginTop: 1 },
  status: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, marginTop: 2 },
  statusText: { flexShrink: 1, color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs, textAlign: 'center' },
  error: { color: color.inkRed },
});
