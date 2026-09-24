/**
 * Find or create a fleet — part-08 §1.
 *
 * Two halves: a list of fleets you could join, and the create form. Creating
 * costs 500 coins and needs Admiralty 4, both of which the SERVER checks —
 * this screen shows the price so the tap is informed, and lets the server say
 * no if the player is short.
 *
 * The name is entered with `InkKeyboard`, the same component the onboarding
 * name screen uses. There is no `TextInput` anywhere in this app.
 */
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  FLEET_CREATE_COST_COINS,
  FLEET_EMBLEM_BADGES,
  FLEET_EMBLEM_TINTS,
  FLEET_NAME_MAX,
  FLEET_NAME_MIN,
  type FleetPolicy,
} from '@engine/fleets';

import { createFleet } from '@/fleet/api';
import { InkButton } from '@/ui/InkButton';
import { InkKeyboard } from '@/ui/InkKeyboard';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const POLICIES: { value: FleetPolicy; label: string; hint: string }[] = [
  { value: 'open', label: 'Open', hint: 'Anyone may walk aboard.' },
  { value: 'request', label: 'By request', hint: 'An officer waves them through.' },
  { value: 'closed', label: 'Closed', hint: 'Nobody new.' },
];

export default function FleetBrowseScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<FleetPolicy>('request');
  const [badge, setBadge] = useState(0);
  const [tint, setTint] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const legal = name.trim().length >= FLEET_NAME_MIN && name.trim().length <= FLEET_NAME_MAX;

  const create = useCallback(() => {
    if (!legal || busy) return;
    setBusy(true);
    setError(null);
    void createFleet({
      name: name.trim(),
      description: '',
      emblemBadge: badge,
      emblemTint: tint,
      policy,
      minRenown: 0,
    })
      .then(() => router.replace('/fleet'))
      .catch((e: unknown) => {
        const code = (e as { code?: string }).code;
        setError(
          code === 'insufficient-coins'
            ? `A charter costs ${FLEET_CREATE_COST_COINS} coins.`
            : code === 'already-in-a-fleet'
              ? 'You already sail with someone.'
              : code === 'needs-admiralty'
                ? 'Fleets open at Admiralty 4.'
                : 'That did not take. Try again.',
        );
      })
      .finally(() => setBusy(false));
  }, [badge, busy, legal, name, policy, router, tint]);

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="fb-back" onPress={() => router.back()} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title="A new fleet" w={280} h={40} size="sm" seedKey="fb-title" />
      </View>

      <View style={styles.form}>
        <InkPanel w={420} h={196} seedKey="fb-form">
          <View style={styles.formBody}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.name}>{name || '—'}</Text>

            <Text style={styles.label}>Who may join</Text>
            <View style={styles.policyRow}>
              {POLICIES.map((option) => (
                <Pressable key={option.value} onPress={() => setPolicy(option.value)}>
                  <Text style={[styles.policy, policy === option.value && styles.policyOn]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>
              {POLICIES.find((p) => p.value === policy)?.hint ?? ''}
            </Text>

            <Text style={styles.label}>Colours</Text>
            <View style={styles.emblemRow}>
              <Pressable onPress={() => setBadge((b) => (b + 1) % FLEET_EMBLEM_BADGES)}>
                <Text style={styles.emblem}>{`Badge ${badge + 1}`}</Text>
              </Pressable>
              <Pressable onPress={() => setTint((t) => (t + 1) % FLEET_EMBLEM_TINTS)}>
                <Text style={styles.emblem}>{`Tint ${tint + 1}`}</Text>
              </Pressable>
            </View>
          </View>
        </InkPanel>
      </View>

      <View style={styles.keyboard}>
        <InkKeyboard value={name} onChange={setName} maxLength={FLEET_NAME_MAX} />
      </View>

      <View style={styles.footer}>
        <Text style={styles.cost}>{`${FLEET_CREATE_COST_COINS} coins`}</Text>
        <InkButton
          label={busy ? 'Signing…' : 'Charter it'}
          tone="confirm"
          size="md"
          w={180}
          h={52}
          seedKey="fb-create"
          disabled={!legal || busy}
          onPress={create}
        />
      </View>

      {error ? (
        <Pressable style={styles.error} onPress={() => setError(null)}>
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      ) : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 140, top: 2 },
  form: { position: 'absolute', left: 20, top: 52 },
  formBody: { padding: space.sm, gap: 2 },
  label: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.xxs, marginTop: 4 },
  name: { color: color.ink, fontFamily: font.display, fontSize: typeScale.lg },
  policyRow: { flexDirection: 'row', gap: space.md },
  policy: { color: color.inkFaint, fontFamily: font.label, fontSize: typeScale.sm },
  policyOn: { color: color.inkRed },
  hint: { color: color.inkFaint, fontFamily: font.body, fontSize: typeScale.xxs },
  emblemRow: { flexDirection: 'row', gap: space.md },
  emblem: { color: color.ink, fontFamily: font.label, fontSize: typeScale.xs },
  keyboard: { position: 'absolute', right: 16, top: 52 },
  footer: {
    position: 'absolute',
    left: 20,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  cost: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.sm },
  error: {
    position: 'absolute',
    left: CANVAS_W / 2 - 200,
    bottom: 2,
    width: 400,
    paddingVertical: 4,
    alignItems: 'center',
    backgroundColor: color.paper,
    borderWidth: 1.5,
    borderColor: color.inkRed,
  },
  errorText: { color: color.inkRed, fontFamily: font.body, fontSize: typeScale.xs },
});
