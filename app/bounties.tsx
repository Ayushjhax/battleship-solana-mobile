/**
 * The Bounty Board and the Captain's Log — part-04 §1, §2.
 *
 * Two tabs on one screen: the board (pinned paper notes) and the log (a
 * leather logbook, a page per tier with a stamp box).
 *
 * §1 — "claim is a tap — never auto-claim, **the stamp is the payoff**." So a
 * completed contract does not quietly credit: it shows a claim button, and
 * tapping it stamps the note. The one place that rule is relaxed is the
 * season's end, where a job sweeps unclaimed pages so nothing is lost.
 *
 * Everything rendered here came from the server. The progress bar draws
 * `progress / target` as the server reported them; the client has no way to
 * compute either (§3).
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { INK_PER_PAGE, SEASON_PAGES, inkIntoPage, rewardForPage } from '@engine/bounties';

import {
  buyPremium,
  claimBounty,
  claimPage,
  getBoard,
  getLog,
  rerollBounty,
  type Board,
  type Log,
} from '@/bounties/api';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

/** §1 — "progress bar drawn as ink ticks". */
function Ticks({ progress, target }: { progress: number; target: number }) {
  const ticks = Math.min(20, Math.max(1, target));
  const filled = Math.round((Math.min(progress, target) / target) * ticks);
  return (
    <View style={styles.ticks}>
      {Array.from({ length: ticks }, (_, n) => (
        <View key={n} style={[styles.tick, n < filled && styles.tickOn]} />
      ))}
    </View>
  );
}

function Note({
  contract,
  onClaim,
  onReroll,
  rerollGems,
}: {
  contract: Board['contracts'][number];
  onClaim: () => void;
  onReroll: () => void;
  rerollGems: number;
}) {
  const done = contract.state === 'done';
  const claimed = contract.state === 'claimed';

  return (
    <View style={styles.note}>
      <InkPanel w={340} h={92} seedKey={`note-${contract.slot}`}>
        <View style={styles.noteBody}>
          <View style={styles.noteHead}>
            <Text style={styles.noteTitle} numberOfLines={1}>
              {contract.title}
            </Text>
            <Text style={styles.noteScope}>{contract.scope === 'weekly' ? 'week' : 'day'}</Text>
          </View>

          <Ticks progress={contract.progress} target={contract.target} />
          <Text style={styles.noteProgress}>
            {`${Math.min(contract.progress, contract.target)} / ${contract.target}`}
          </Text>

          <View style={styles.noteFoot}>
            <Text style={styles.chip}>{`${contract.reward.coins}c`}</Text>
            <Text style={styles.chip}>{`${contract.reward.steel}s`}</Text>
            <Text style={styles.chip}>{`${contract.reward.ink} ink`}</Text>
            {contract.reward.gems > 0 ? (
              <Text style={styles.chip}>{`${contract.reward.gems}g`}</Text>
            ) : null}
          </View>
        </View>
      </InkPanel>

      {/* The stamp IS the payoff — a done note gets a button, never a credit. */}
      {claimed ? (
        <View style={styles.stamp} pointerEvents="none">
          <Text style={styles.stampText}>CLAIMED</Text>
        </View>
      ) : done ? (
        <View style={styles.claim}>
          <InkButton
            label="Claim"
            tone="confirm"
            size="sm"
            w={90}
            h={34}
            seedKey={`claim-${contract.slot}`}
            onPress={onClaim}
          />
        </View>
      ) : (
        <View style={styles.claim}>
          <InkButton
            label={rerollGems > 0 ? `↻ ${rerollGems}g` : '↻'}
            size="sm"
            w={90}
            h={34}
            seedKey={`reroll-${contract.slot}`}
            onPress={onReroll}
          />
        </View>
      )}
    </View>
  );
}

export default function BountiesScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'board' | 'log'>('board');
  const [board, setBoard] = useState<Board | null>(null);
  const [log, setLog] = useState<Log | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void getBoard().then(setBoard).catch(() => setNotice('The office is shut.'));
    void getLog().then(setLog).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const act = useCallback(
    (run: () => Promise<unknown>, failure: string) => {
      if (busy) return;
      setBusy(true);
      void run()
        .then(load)
        .catch(() => setNotice(failure))
        .finally(() => setBusy(false));
    },
    [busy, load],
  );

  const page = inkIntoPage(log?.ink ?? 0);

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="bb-back" onPress={() => router.back()} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon
          title={tab === 'board' ? 'Bounty Board' : "Captain's Log"}
          w={300}
          h={40}
          size="sm"
          seedKey="bb-title"
        />
      </View>

      <View style={styles.tabs}>
        {(['board', 'log'] as const).map((which) => (
          <Pressable key={which} onPress={() => setTab(which)}>
            <Text style={[styles.tab, tab === which && styles.tabOn]}>
              {which === 'board' ? 'Board' : 'Log'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'board' ? (
        <ScrollView style={styles.boardScroll} contentContainerStyle={styles.boardContent}>
          {(board?.contracts ?? []).length === 0 ? (
            <Text style={styles.empty}>The board is bare. Come back tomorrow.</Text>
          ) : (
            board!.contracts.map((contract) => (
              <Note
                key={contract.slot}
                contract={contract}
                rerollGems={board!.nextRerollGems}
                onClaim={() => act(() => claimBounty(contract.slot), 'That one is not ready.')}
                onReroll={() =>
                  act(() => rerollBounty(contract.slot), 'No gems, or nothing left to draw.')
                }
              />
            ))
          )}
        </ScrollView>
      ) : (
        <>
          <View style={styles.logHead}>
            <Text style={styles.inkBig}>{`Page ${page.page} of ${SEASON_PAGES}`}</Text>
            <Text style={styles.inkSmall}>{`${page.into} / ${INK_PER_PAGE} ink`}</Text>
            {log?.premium ? <Text style={styles.premium}>Premium</Text> : null}
          </View>

          <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent}>
            {Array.from({ length: SEASON_PAGES }, (_, n) => n + 1).map((p) => {
              const reward = rewardForPage(p, log?.premium ?? false);
              const claimed = (log?.claimed ?? []).includes(p);
              const claimable = (log?.claimable ?? []).includes(p);
              return (
                <Pressable
                  key={p}
                  disabled={!claimable}
                  onPress={() => act(() => claimPage(p), 'Not earned yet.')}
                  style={[styles.page, claimed && styles.pageClaimed, claimable && styles.pageReady]}
                >
                  <Text style={styles.pageNum}>{p}</Text>
                  <Text style={styles.pageReward} numberOfLines={1}>
                    {`${reward.coins}c ${reward.steel}s${reward.gems ? ` ${reward.gems}g` : ''}`}
                  </Text>
                  {reward.cosmetic ? <Text style={styles.cosmetic}>ink set</Text> : null}
                  {claimed ? <Text style={styles.pageStamp}>✓</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {!log?.premium ? (
            <View style={styles.premiumButton}>
              <InkButton
                label="Premium · 500 gems"
                size="sm"
                w={220}
                h={44}
                seedKey="bb-premium"
                onPress={() => act(() => buyPremium(), 'Not enough gems.')}
              />
            </View>
          ) : null}
        </>
      )}

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
  tabs: { position: 'absolute', right: space.md, top: 14, flexDirection: 'row', gap: space.md },
  tab: { color: color.inkFaint, fontFamily: font.label, fontSize: typeScale.sm },
  tabOn: { color: color.inkRed },

  boardScroll: { position: 'absolute', left: 30, top: 48, width: CANVAS_W - 60, height: CANVAS_H - 56 },
  boardContent: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingBottom: space.md },
  note: { position: 'relative' },
  noteBody: { padding: space.xs, gap: 2 },
  noteHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  noteTitle: { flex: 1, color: color.ink, fontFamily: font.label, fontSize: typeScale.xs },
  noteScope: { color: color.inkFaint, fontFamily: font.body, fontSize: typeScale.xxs },
  ticks: { flexDirection: 'row', gap: 2, height: 8, alignItems: 'center' },
  tick: { flex: 1, height: 5, backgroundColor: color.inkFaint },
  tickOn: { backgroundColor: color.ink, height: 8 },
  noteProgress: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs },
  noteFoot: { flexDirection: 'row', gap: space.xs },
  chip: { color: color.ink, fontFamily: font.label, fontSize: typeScale.xxs },
  claim: { position: 'absolute', right: 6, bottom: 6 },
  stamp: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    borderWidth: 2,
    borderColor: color.inkGreen,
    paddingHorizontal: 6,
    paddingVertical: 2,
    transform: [{ rotate: '-8deg' }],
  },
  stampText: { color: color.inkGreen, fontFamily: font.display, fontSize: typeScale.xxs },

  logHead: { position: 'absolute', left: 30, top: 46, flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  inkBig: { color: color.ink, fontFamily: font.display, fontSize: typeScale.lg },
  inkSmall: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs },
  premium: { color: color.inkRed, fontFamily: font.label, fontSize: typeScale.xs },
  logScroll: { position: 'absolute', left: 30, top: 76, width: CANVAS_W - 60, height: CANVAS_H - 132 },
  logContent: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  page: {
    width: 92,
    height: 54,
    borderWidth: 1,
    borderColor: color.gridMajor,
    padding: 4,
    justifyContent: 'space-between',
  },
  pageClaimed: { borderColor: color.inkGreen },
  pageReady: { borderColor: color.inkRed, borderWidth: 2 },
  pageNum: { color: color.inkFaint, fontFamily: font.display, fontSize: typeScale.xs },
  pageReward: { color: color.ink, fontFamily: font.body, fontSize: typeScale.xxs },
  cosmetic: { color: color.inkRed, fontFamily: font.label, fontSize: typeScale.xxs },
  pageStamp: { position: 'absolute', right: 4, top: 2, color: color.inkGreen, fontSize: 12 },
  premiumButton: { position: 'absolute', left: CANVAS_W / 2 - 110, bottom: 6 },

  empty: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.md, padding: space.lg },
  notice: {
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
  noticeText: { color: color.inkRed, fontFamily: font.body, fontSize: typeScale.xs },
});
