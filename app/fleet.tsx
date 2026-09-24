/**
 * The Fleet Hall — part-08 §1, §2, §3.
 *
 * Three panels on one screen, because a fleet is one place: the roster on the
 * left, quick chat in the middle, donations on the right. Splitting them into
 * tabs would mean a player who came to donate has to find the donations, and
 * the whole point of §3 is that filling a fleetmate's request is a thing you
 * do in passing.
 *
 * Every decision here comes from `@engine/fleets`: who may kick (the
 * permission table), what a commission costs, which phrases exist, whether the
 * rate limit allows one more. The screen draws.
 *
 * Reused: `Paper`, `Scale`, `InkButton`, `InkPanel`, `TitleRibbon`,
 * `AvatarCard`-style rows, and the ink tokens. Nothing new was drawn.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  QUICK_PHRASES,
  canKick,
  commissionCost,
  phraseById,
  reinforcementCapacity,
  reinforcementFuelHeld,
  type FleetRole,
  type PhraseGroup,
} from '@engine/fleets';

import { countryName } from '@/data/countries';
import {
  fillDonation,
  getChat,
  getDonations,
  getMyFleet,
  leaveFleet,
  requestItem,
  sendQuickChat,
  type Donations,
  type FleetView,
} from '@/fleet/api';
import { useProfile } from '@/state/profile';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const PANEL_Y = 54;
const PANEL_H = CANVAS_H - PANEL_Y - 12;
const ROSTER_W = 250;
const CHAT_W = 280;
const DONATE_W = 236;

const ROLE_LABEL: Record<FleetRole, string> = {
  admiral: 'Admiral',
  commodore: 'Commodore',
  officer: 'Officer',
  sailor: 'Sailor',
};

// ---------------------------------------------------------------------------

export default function FleetScreen() {
  const router = useRouter();
  const [view, setView] = useState<FleetView | null>(null);
  const [donations, setDonations] = useState<Donations | null>(null);
  const [chat, setChat] = useState<{ userId: string; kind: string; code: string; at: number }[]>([]);
  const [group, setGroup] = useState<PhraseGroup>('greetings');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void getMyFleet().then(setView).catch(() => setNotice('Could not reach the hall.'));
    void getDonations().then(setDonations).catch(() => undefined);
    void getChat().then(setChat).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const myRole = view?.myRole ?? null;
  const fleet = view?.fleet ?? null;

  const say = useCallback(
    (code: string) => {
      if (busy) return;
      setBusy(true);
      void sendQuickChat('phrase', code)
        .then(() => void getChat().then(setChat).catch(() => undefined))
        .catch(() => setNotice('Steady on — one signal at a time.'))
        .finally(() => setBusy(false));
    },
    [busy],
  );

  const ask = useCallback(
    (item: string) => {
      if (busy) return;
      setBusy(true);
      void requestItem(item)
        .then(() => void getDonations().then(setDonations).catch(() => undefined))
        .catch(() => setNotice('You asked recently. Give it half an hour.'))
        .finally(() => setBusy(false));
    },
    [busy],
  );

  const fill = useCallback(
    (donationId: string) => {
      if (busy) return;
      setBusy(true);
      void fillDonation(donationId)
        .then(() => void getDonations().then(setDonations).catch(() => undefined))
        .catch(() => setNotice('Somebody beat you to it.'))
        .finally(() => setBusy(false));
    },
    [busy],
  );

  // No fleet yet: send them to the browser rather than showing three empty panels.
  if (view && !fleet) {
    return (
      <Scale>
        <Paper variant="full" />
        <View style={styles.back}>
          <InkButton label="↩" size="lg" w={54} h={48} seedKey="fl-back" onPress={() => router.back()} />
        </View>
        <View style={styles.centre}>
          <Text style={styles.emptyTitle}>You sail alone.</Text>
          <Text style={styles.emptyBody}>
            A fleet shares weapons, fights wars and lets you practise on each other&apos;s harbours.
          </Text>
          <View style={{ marginTop: space.md }}>
            <InkButton
              label="Find a fleet"
              tone="confirm"
              size="md"
              w={200}
              h={54}
              seedKey="fl-find"
              onPress={() => router.push('/fleet-browse')}
            />
          </View>
        </View>
      </Scale>
    );
  }

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="fl-back" onPress={() => router.back()} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title={fleet?.name ?? 'Fleet Hall'} w={280} h={40} size="sm" seedKey="fl-title" />
      </View>
      <Text style={styles.count}>{`${view?.members.length ?? 0} / 30`}</Text>

      {/* ---- the roster (§1) ------------------------------------------- */}
      <View style={[styles.panel, { left: 12, width: ROSTER_W }]}>
        <InkPanel w={ROSTER_W} h={PANEL_H} seedKey="fl-roster">
          <Text style={styles.panelTitle}>Roster</Text>
          <ScrollView style={styles.scroll}>
            {(view?.members ?? []).map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                myRole={myRole}
                onVisit={() => router.push(`/visit?userId=${member.userId}`)}
              />
            ))}
          </ScrollView>
        </InkPanel>
      </View>

      {/* ---- quick chat (§2) ------------------------------------------- */}
      <View style={[styles.panel, { left: 12 + ROSTER_W + 8, width: CHAT_W }]}>
        <InkPanel w={CHAT_W} h={PANEL_H} seedKey="fl-chat">
          <Text style={styles.panelTitle}>Signals</Text>

          <ScrollView style={styles.chatLog}>
            {chat.length === 0 ? (
              <Text style={styles.quiet}>Quiet on deck.</Text>
            ) : (
              [...chat].reverse().map((message, n) => (
                <Text key={`${message.at}-${n}`} style={styles.chatLine} numberOfLines={1}>
                  {message.kind === 'phrase'
                    ? (phraseById(message.code)?.text ?? '')
                    : `[sticker ${message.code}]`}
                </Text>
              ))
            )}
          </ScrollView>

          {/* Four groups, and inside one group its six phrases. No keyboard,
              no free text — §2, and there is no input to type into. */}
          <View style={styles.groupRow}>
            {(['greetings', 'requests', 'tactics', 'praise'] as const).map((g) => (
              <Pressable key={g} onPress={() => setGroup(g)} style={styles.groupTab}>
                <Text style={[styles.groupText, group === g && styles.groupActive]}>
                  {g.charAt(0).toUpperCase() + g.slice(1, 4)}
                </Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.phrases}>
            {QUICK_PHRASES.filter((p) => p.group === group).map((phrase) => (
              <Pressable key={phrase.id} onPress={() => say(phrase.id)} style={styles.phrase}>
                <Text style={styles.phraseText} numberOfLines={1}>
                  {phrase.text}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </InkPanel>
      </View>

      {/* ---- donations (§3) -------------------------------------------- */}
      <View style={[styles.panel, { left: 12 + ROSTER_W + CHAT_W + 16, width: DONATE_W }]}>
        <InkPanel w={DONATE_W} h={PANEL_H} seedKey="fl-donate">
          <Text style={styles.panelTitle}>Requests</Text>
          <Slots donations={donations} />

          <ScrollView style={styles.scroll}>
            {(donations?.requests ?? []).length === 0 ? (
              <Text style={styles.quiet}>Nobody needs anything.</Text>
            ) : (
              donations!.requests.map((donation) => (
                <View key={donation.id} style={styles.request}>
                  <Text style={styles.requestItem} numberOfLines={1}>
                    {donation.item}
                  </Text>
                  <InkButton
                    label={`${commissionCost(donation.item as never)}c`}
                    size="sm"
                    w={62}
                    h={30}
                    seedKey={`fl-fill-${donation.id.slice(0, 4)}`}
                    onPress={() => fill(donation.id)}
                  />
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.askRow}>
            {(['bomber', 'submarine', 'torpedoBomber'] as const).map((item) => (
              <InkButton
                key={item}
                label={item === 'torpedoBomber' ? 'Torp' : item === 'bomber' ? 'Bomb' : 'Sub'}
                size="sm"
                w={68}
                h={34}
                seedKey={`fl-ask-${item}`}
                onPress={() => ask(item)}
              />
            ))}
          </View>
        </InkPanel>
      </View>

      <View style={styles.footer}>
        <InkButton
          label="War"
          tone="confirm"
          size="sm"
          w={100}
          h={40}
          seedKey="fl-war"
          onPress={() => router.push('/fleet-war')}
        />
        <InkButton
          label="Leave"
          size="sm"
          w={100}
          h={40}
          seedKey="fl-leave"
          onPress={() => void leaveFleet().then(load).catch(() => setNotice('Could not leave.'))}
        />
      </View>

      {notice ? (
        <Pressable style={styles.notice} onPress={() => setNotice(null)}>
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}
    </Scale>
  );
}

// ---------------------------------------------------------------------------

function MemberRow({
  member,
  myRole,
  onVisit,
}: {
  member: FleetView['members'][number];
  myRole: FleetRole | null;
  onVisit: () => void;
}) {
  const me = useProfile((state) => state.name);
  // The permission table decides what this row offers — not the screen.
  const mayKick = myRole ? canKick(myRole, member.role).ok : false;

  return (
    <Pressable onPress={onVisit} style={styles.member} accessibilityRole="button">
      <View style={{ flex: 1 }}>
        <Text style={styles.memberName} numberOfLines={1}>
          {member.name}
          {member.name === me ? ' (you)' : ''}
        </Text>
        <Text style={styles.memberSub} numberOfLines={1}>
          {`${ROLE_LABEL[member.role]} · ${member.merit} merit · ${countryName(member.countryCode)}`}
        </Text>
      </View>
      {mayKick ? <Text style={styles.kickHint}>·</Text> : null}
    </Pressable>
  );
}

/** §3 — the reinforcement slots, as fuel held over capacity. */
function Slots({ donations }: { donations: Donations | null }) {
  const held = donations?.held ?? [];
  const fuel = useMemo(
    () =>
      reinforcementFuelHeld(
        held.map((d) => ({
          id: d.id,
          item: d.item,
          fuel: commissionCost(d.item as never) / 6,
          donorId: d.donorId ?? '',
          filledAt: d.filledAt ?? 0,
        })),
      ),
    [held],
  );
  // The capacity is the Fleet Hall's; the server gates it, and this is a
  // readout, not a second opinion.
  const capacity = reinforcementCapacity(5);

  return (
    <Text style={styles.slots}>
      {`Slots ${fuel} / ${capacity}`}
      {held.length > 0 ? ` · ${held.length} waiting` : ''}
    </Text>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 140, top: 2 },
  count: {
    position: 'absolute',
    right: space.md,
    top: 14,
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.sm,
  },
  panel: { position: 'absolute', top: PANEL_Y },
  panelTitle: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.sm,
    textAlign: 'center',
    height: 22,
    lineHeight: 22,
  },
  scroll: { flex: 1, paddingHorizontal: space.xs },

  member: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: color.gridMinor,
  },
  memberName: { color: color.ink, fontFamily: font.label, fontSize: typeScale.xs },
  memberSub: { color: color.inkFaint, fontFamily: font.body, fontSize: typeScale.xxs },
  kickHint: { color: color.inkFaint, fontFamily: font.label, fontSize: typeScale.sm },

  chatLog: { height: 96, paddingHorizontal: space.xs },
  chatLine: { color: color.ink, fontFamily: font.body, fontSize: typeScale.xxs, paddingVertical: 1 },
  quiet: { color: color.inkFaint, fontFamily: font.body, fontSize: typeScale.xxs, padding: 6 },
  groupRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: color.gridMajor,
    paddingTop: 3,
  },
  groupTab: { paddingHorizontal: 4, paddingVertical: 2 },
  groupText: { color: color.inkFaint, fontFamily: font.label, fontSize: typeScale.xxs },
  groupActive: { color: color.inkRed },
  phrases: { flex: 1, paddingHorizontal: space.xs },
  phrase: { paddingVertical: 3 },
  phraseText: { color: color.ink, fontFamily: font.body, fontSize: typeScale.xxs },

  slots: {
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
    textAlign: 'center',
    paddingBottom: 2,
  },
  request: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: color.gridMinor,
  },
  requestItem: { flex: 1, color: color.ink, fontFamily: font.body, fontSize: typeScale.xxs },
  askRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4 },

  footer: { position: 'absolute', right: space.md, top: 8, flexDirection: 'row', gap: space.xs },
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
  emptyTitle: { color: color.ink, fontFamily: font.display, fontSize: typeScale.lg },
  emptyBody: {
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    textAlign: 'center',
    marginTop: space.xs,
  },
  notice: {
    position: 'absolute',
    left: CANVAS_W / 2 - 200,
    bottom: 4,
    width: 400,
    paddingVertical: 4,
    alignItems: 'center',
    backgroundColor: color.paper,
    borderWidth: 1.5,
    borderColor: color.inkRed,
  },
  noticeText: { color: color.inkRed, fontFamily: font.body, fontSize: typeScale.xs },
});
