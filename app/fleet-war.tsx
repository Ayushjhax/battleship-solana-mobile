/**
 * The fleet war — part-08 §4.
 *
 * One screen, three states, because a war IS three states: preparing,
 * fighting, or over. The scoreboard is the same `sideScore()` the settlement
 * uses, so what a player watches during the battle day is the arithmetic that
 * will actually pay them.
 *
 * WHAT IS NOT HERE, DELIBERATELY: the enemy's war harbours. §4 says "Both war
 * maps are visible — names, Admiralty levels, renown, nothing about layouts",
 * and the /war response has no `harbour` field to render even if this screen
 * wanted one (see the schema in src/fleet/api.ts).
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RAIDS_PER_MEMBER, WAR_SIZES, raidsLeft } from '@engine/fleets';

import { getWar, setWarOptIn, startWar, type WarView } from '@/fleet/api';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

/** The clock, from the server's timestamps. Same rule as every other timer. */
function remaining(endsAt: number | null, now: number): string {
  if (endsAt === null) return '—';
  const left = Math.max(0, endsAt - now);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function FleetWarScreen() {
  const router = useRouter();
  const [view, setView] = useState<WarView | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    void getWar()
      .then((next) => {
        setView(next);
        setNow(next.serverNow);
      })
      .catch(() => setNotice('Could not reach the war room.'));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow((n) => n + 30_000), 30_000);
    return () => clearInterval(timer);
  }, []);

  const war = view?.war ?? null;

  const begin = useCallback(
    (size: 5 | 10 | 15) => {
      if (busy) return;
      setBusy(true);
      void startWar(size)
        .then(load)
        .catch((e: unknown) => {
          const code = (e as { code?: string }).code;
          setNotice(
            code === 'not-allowed'
              ? 'The Admiral or a Commodore calls a war, and enough must have signed the articles.'
              : code === 'war-in-progress'
                ? 'You are already at war.'
                : 'Could not call the war.',
          );
        })
        .finally(() => setBusy(false));
    },
    [busy, load],
  );

  // ---- no war: the call-to-arms ------------------------------------------
  if (view && !war) {
    return (
      <Scale>
        <Paper variant="full" />
        <View style={styles.back}>
          <InkButton label="↩" size="lg" w={54} h={48} seedKey="fw-back" onPress={() => router.back()} />
        </View>
        <View style={styles.centre}>
          <Text style={styles.title}>No war at sea.</Text>
          <Text style={styles.body}>
            A war is 22 hours to prepare and a day to fight. Everyone who signs gets two raids.
          </Text>
          <View style={styles.sizes}>
            {WAR_SIZES.map((size) => (
              <InkButton
                key={size}
                label={`${size} v ${size}`}
                tone="confirm"
                size="md"
                w={130}
                h={52}
                seedKey={`fw-${size}`}
                onPress={() => begin(size)}
              />
            ))}
          </View>
          <View style={{ marginTop: space.md }}>
            <InkButton
              label="Sign the articles"
              size="sm"
              w={200}
              h={44}
              seedKey="fw-optin"
              onPress={() => void setWarOptIn(true).then(load).catch(() => undefined)}
            />
          </View>
        </View>
        {notice ? (
          <Pressable style={styles.notice} onPress={() => setNotice(null)}>
            <Text style={styles.noticeText}>{notice}</Text>
          </Pressable>
        ) : null}
      </Scale>
    );
  }

  const scoreboard = view?.scoreboard;
  const prep = war?.state === 'prep';
  const battle = war?.state === 'battle';

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="fw-back" onPress={() => router.back()} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon
          title={prep ? 'Preparation day' : battle ? 'Battle day' : 'War'}
          w={300}
          h={40}
          size="sm"
          seedKey="fw-title"
        />
      </View>
      <Text style={styles.clock}>
        {prep
          ? remaining(war?.prepEndsAt ?? null, now)
          : remaining(war?.battleEndsAt ?? null, now)}
      </Text>

      {/* The score, big, in the middle. It is the only number that matters. */}
      <View style={styles.score}>
        <Text style={styles.scoreNum}>{scoreboard?.a.stars ?? 0}</Text>
        <Text style={styles.scoreDash}>—</Text>
        <Text style={styles.scoreNum}>{scoreboard?.b.stars ?? 0}</Text>
      </View>
      <Text style={styles.destruction}>
        {`${Math.round((scoreboard?.a.destruction ?? 0) * 100)}% · ${Math.round(
          (scoreboard?.b.destruction ?? 0) * 100,
        )}%`}
      </Text>

      {/* The two war maps: names and numbers, never layouts (§4). */}
      <View style={[styles.side, { left: 16 }]}>
        <InkPanel w={340} h={CANVAS_H - 140} seedKey="fw-a">
          <Text style={styles.sideTitle}>Us</Text>
          <ScrollView style={styles.list}>
            {(view?.members ?? [])
              .filter((m) => m.fleetId === war?.fleetA)
              .map((member) => (
                <View key={member.userId} style={styles.row}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {member.userId.slice(0, 8)}
                  </Text>
                  <Text style={styles.rowSub}>
                    {`${member.renown} renown · ${raidsLeft(member)} of ${RAIDS_PER_MEMBER} left`}
                  </Text>
                </View>
              ))}
          </ScrollView>
        </InkPanel>
      </View>

      <View style={[styles.side, { right: 16 }]}>
        <InkPanel w={340} h={CANVAS_H - 140} seedKey="fw-b">
          <Text style={styles.sideTitle}>Them</Text>
          <ScrollView style={styles.list}>
            {(scoreboard?.a.targets ?? []).map((target) => (
              <Pressable
                key={target.targetUserId}
                disabled={!battle}
                onPress={() => router.push(`/raid?war=1&target=${target.targetUserId}`)}
                style={styles.row}
              >
                <Text style={styles.rowName} numberOfLines={1}>
                  {target.targetUserId.slice(0, 8)}
                </Text>
                <Text style={styles.rowSub}>
                  {target.attempts === 0
                    ? 'untouched'
                    : `${'★'.repeat(target.stars)}${'☆'.repeat(3 - target.stars)} · ${Math.round(
                        target.destruction * 100,
                      )}%`}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </InkPanel>
      </View>

      {prep ? (
        <View style={styles.footer}>
          <InkButton
            label="Set war harbour"
            tone="confirm"
            size="sm"
            w={190}
            h={44}
            seedKey="fw-harbour"
            onPress={() => router.push('/placement?mode=harbour&war=1')}
          />
        </View>
      ) : null}

      {notice ? (
        <Pressable style={styles.notice} onPress={() => setNotice(null)}>
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 150, top: 2 },
  clock: {
    position: 'absolute',
    right: space.md,
    top: 14,
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.md,
  },
  score: {
    position: 'absolute',
    left: CANVAS_W / 2 - 90,
    top: 46,
    width: 180,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
    gap: space.sm,
  },
  scoreNum: { color: color.ink, fontFamily: font.display, fontSize: typeScale.xxl },
  scoreDash: { color: color.inkFaint, fontFamily: font.display, fontSize: typeScale.lg },
  destruction: {
    position: 'absolute',
    left: CANVAS_W / 2 - 90,
    top: 96,
    width: 180,
    textAlign: 'center',
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
  side: { position: 'absolute', top: 50 },
  sideTitle: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.sm,
    textAlign: 'center',
    height: 22,
    lineHeight: 22,
  },
  list: { flex: 1, paddingHorizontal: space.xs },
  row: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: color.gridMinor },
  rowName: { color: color.ink, fontFamily: font.label, fontSize: typeScale.xs },
  rowSub: { color: color.inkFaint, fontFamily: font.body, fontSize: typeScale.xxs },
  centre: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CANVAS_W,
    height: CANVAS_H,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 120,
  },
  title: { color: color.ink, fontFamily: font.display, fontSize: typeScale.lg },
  body: {
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    textAlign: 'center',
    marginTop: space.xs,
  },
  sizes: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  footer: { position: 'absolute', left: CANVAS_W / 2 - 95, bottom: 8 },
  notice: {
    position: 'absolute',
    left: CANVAS_W / 2 - 220,
    bottom: 2,
    width: 440,
    paddingVertical: 4,
    alignItems: 'center',
    backgroundColor: color.paper,
    borderWidth: 1.5,
    borderColor: color.inkRed,
  },
  noticeText: { color: color.inkRed, fontFamily: font.body, fontSize: typeScale.xs },
});
