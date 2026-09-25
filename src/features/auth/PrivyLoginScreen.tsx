/**
 * Captain's log-in, drawn to its mockup on BACKGROUNDS.login:
 *   left    the logo, the "Captain's log-in" title, the pitch, the anchor rule
 *           and the Privy note, with a sailing ship in the waves below
 *   right   the sign-in panel: Google, then email + one-time code
 *   around  the mockup's handwriting, gulls, crown, compass, bottle and scroll —
 *           pointerEvents none, clear of every control
 *
 * Every control is art from LOGIN_ART with a live label (LoginArt.tsx).
 */
import { useLoginWithEmail, useLoginWithOAuth } from '@privy-io/expo';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View, type ImageStyle } from 'react-native';

import { ArtButton, ArtInput } from '@/features/auth/LoginArt';
import { BACKGROUNDS, LOGIN_ART, type Asset } from '@/ui/assets';
import { InkSpinner } from '@/ui/InkSpinner';
import { Scale } from '@/ui/Scale';
import { artColor, color, font, menuFont, type as typeScale } from '@/ui/tokens';

const RESEND_SECONDS = 30;

/** login-panel.png is 656 x 699; its wheel ornament ends 51 units down at this width. */
const PANEL = { x: 448, y: 14, w: 312, h: Math.round((312 * 699) / 656) } as const;
const INSET = 22;
const ROW_W = PANEL.w - INSET * 2;
const GAP = 10;

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel/i.test(message)) return 'Sign-in was cancelled.';
  if (/network|fetch|offline|timeout/i.test(message)) return 'Check your connection and try again.';
  if (/rate|too many/i.test(message)) return 'Too many attempts. Wait a moment and try again.';
  if (/code|otp/i.test(message)) return 'That code was not accepted. Check it and try again.';
  return message.length <= 120 ? message : 'Sign-in could not be completed. Please try again.';
}

/** A piece of art at a fixed place on the canvas, never in the way of a touch. */
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
      <Scale backgroundImage={BACKGROUNDS.login}>
        {/* The mockup's margins: handwriting, gulls and flotsam around the page. */}
        <Text style={[styles.hand, styles.handLeft]} pointerEvents="none">
          {'Small\nShips\nBig\nStories'}
        </Text>
        <Text style={[styles.hand, styles.handTop]} pointerEvents="none">
          {'Chart\nConquer\nCollect'}
        </Text>
        <Art source={LOGIN_ART.crown} style={styles.crown} />
        <Art source={LOGIN_ART.seagullLarge} style={styles.gullLarge} />
        <Art source={LOGIN_ART.seagullSmall} style={styles.gullSmall} />
        <Art source={LOGIN_ART.compass} style={styles.compass} />
        <Art source={LOGIN_ART.sailingShip} style={styles.ship} />
        <Art source={LOGIN_ART.messageBottle} style={styles.bottle} />

        <Art source={LOGIN_ART.logo} style={styles.logo} />
        <Art source={LOGIN_ART.title} style={styles.title} />
        <Text style={styles.copy}>
          Sign in before setting sail. Your secure Solana wallet is created automatically.
        </Text>
        <Art source={LOGIN_ART.anchorDivider} style={styles.divider} />
        <Text style={styles.note}>No seed phrase to manage. Privy keeps the signing key protected.</Text>

        <View style={styles.panel}>
          <Image source={LOGIN_ART.panel} style={StyleSheet.absoluteFill} contentFit="fill" />
          <Art source={LOGIN_ART.chooseTitle} style={styles.chooseTitle} />

          <View style={[styles.row, { top: 87 }]}>
            <ArtButton
              slices={LOGIN_ART.google}
              w={ROW_W}
              h={40}
              label={googleBusy ? 'Opening Google…' : 'Continue with Google'}
              clear="both"
              disabled={busy}
              onPress={() => void loginWithGoogle()}
            />
          </View>

          <View style={[styles.row, styles.orRow, { top: 132 }]}>
            <View style={styles.orRule} />
            <Text style={styles.or}>or use email + one-time code</Text>
            <View style={styles.orRule} />
          </View>

          <View style={[styles.row, { top: 151 }]}>
            <ArtInput
              slices={LOGIN_ART.emailInput}
              w={ROW_W}
              h={38}
              value={email}
              onChangeText={setEmail}
              placeholder="captain@example.com"
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
          </View>

          {codeSent ? (
            <>
              <View style={[styles.row, styles.pair, { top: 196 }]}>
                <ArtInput
                  slices={LOGIN_ART.codeInput}
                  w={152}
                  h={38}
                  value={code}
                  onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  editable={!busy}
                  inputMode="numeric"
                  keyboardType="number-pad"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={() => void submitCode()}
                  accessibilityLabel="One-time code"
                />
                <ArtButton
                  slices={LOGIN_ART.confirm}
                  w={ROW_W - 152 - GAP}
                  h={38}
                  label={emailBusy ? 'Checking…' : 'Sign in'}
                  disabled={!codeValid || busy}
                  onPress={() => void submitCode()}
                />
              </View>
              <View style={[styles.row, styles.pair, { top: 241 }]}>
                <ArtButton
                  slices={LOGIN_ART.changeEmail}
                  w={(ROW_W - GAP) / 2}
                  h={34}
                  label="Change email"
                  clear="left"
                  fontSize={typeScale.xs}
                  disabled={busy}
                  onPress={changeEmail}
                />
                <ArtButton
                  slices={LOGIN_ART.resend}
                  w={(ROW_W - GAP) / 2}
                  h={34}
                  label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  clear="left"
                  fontSize={typeScale.xs}
                  mutedWhenDisabled
                  disabled={busy || cooldown > 0}
                  onPress={() => void sendCode()}
                />
              </View>
            </>
          ) : (
            <View style={[styles.row, { top: 196 }]}>
              <ArtButton
                slices={LOGIN_ART.confirm}
                w={ROW_W}
                h={40}
                label={emailBusy ? 'Sending…' : 'Email me a code'}
                disabled={!emailValid || busy}
                onPress={() => void sendCode()}
              />
            </View>
          )}

          <View
            style={[styles.row, styles.status, { top: codeSent ? 281 : 244 }]}
            accessibilityLiveRegion="polite"
          >
            {busy ? <InkSpinner size={16} seedKey="login-action" /> : null}
            <Text style={[styles.statusText, error ? styles.error : null]} numberOfLines={2}>
              {error ?? (codeSent ? `Code sent to ${normalizedEmail}` : 'Your email is never shown to other players.')}
            </Text>
          </View>
        </View>

        {/* Over the panel's corner, like the mockup — below every control. */}
        <Art source={LOGIN_ART.parchmentScroll} style={styles.scroll} />
      </Scale>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.paper },

  logo: { left: 94, top: 46, width: 290, height: 88 },
  title: { left: 121, top: 142, width: 236, height: 35 },
  copy: {
    position: 'absolute',
    left: 64,
    top: 184,
    width: 350,
    color: artColor.ink,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    lineHeight: 21,
    textAlign: 'center',
  },
  divider: { left: 179, top: 230, width: 120, height: 26 },
  note: {
    position: 'absolute',
    left: 114,
    top: 258,
    width: 250,
    color: artColor.soft,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    lineHeight: 15,
    textAlign: 'center',
  },

  hand: {
    position: 'absolute',
    color: artColor.ink,
    fontFamily: menuFont.hand,
    fontSize: typeScale.xs,
    lineHeight: 13,
  },
  handLeft: { left: 16, top: 10, transform: [{ rotate: '-14deg' }] },
  handTop: { left: 322, top: 4, transform: [{ rotate: '-12deg' }] },
  crown: { left: 386, top: 6, width: 28, height: 25 },
  gullLarge: { left: 196, top: 14, width: 46, height: 20 },
  gullSmall: { left: 252, top: 32, width: 32, height: 15 },
  compass: { left: 760, top: 4, width: 38, height: 38 },
  ship: { left: 2, top: 236, width: 104, height: 104 },
  bottle: { left: 330, top: 314, width: 58, height: 44 },
  scroll: { left: 726, top: 290, width: 74, height: 63 },

  panel: { position: 'absolute', left: PANEL.x, top: PANEL.y, width: PANEL.w, height: PANEL.h },
  chooseTitle: { left: (PANEL.w - 222) / 2, top: 56, width: 222, height: 24 },
  row: { position: 'absolute', left: INSET, width: ROW_W },
  pair: { flexDirection: 'row', gap: GAP },
  orRow: { height: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  orRule: { flex: 1, height: 1, backgroundColor: artColor.soft, opacity: 0.6 },
  or: { color: artColor.soft, fontFamily: font.body, fontSize: typeScale.xxs },
  status: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  statusText: {
    flexShrink: 1,
    color: artColor.soft,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    lineHeight: 14,
    textAlign: 'center',
  },
  error: { color: color.inkRed },
});
