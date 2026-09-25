/**
 * Choose game progress — IMG_9754. Shown ONLY when a played-on local profile
 * and a played-on cloud profile differ (the boot decides; see app/index.tsx).
 * Local, warm pink: "Currently loaded". Cloud, cool violet: the last save
 * time. Choosing one overwrites the other and routes to /menu.
 */
import { rankProgress } from '@engine/ranks';
import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg from 'react-native-svg';

import { cloudAsLocal, localAsPatch, type CloudProfile } from '@/net/profileSync';
import { pushProfile } from '@/net/profileSync';
import { useCloud } from '@/state/cloud';
import { useProfile, type ProfileData } from '@/state/profile';
import { BACKGROUNDS } from '@/ui/assets';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { RankBadge } from '@/ui/RankBadge';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import {
  RoughShape,
  hashString,
  roughCircle,
  roughLine,
  roughPolygon,
  type PathInfo,
} from '@/ui/useRough';

const PANEL = { w: 310, h: 268 } as const;
const WARM = '#FBEDE9';
const COOL = '#EDEAFB';

type Stat = 'battles' | 'gems' | 'buildings';

/** Crossed swords, a gem, a map pin — drawn, in a 20 x 20 box. */
function statIcon(kind: Stat, seed: number): (readonly PathInfo[])[] {
  const ink = { stroke: color.ink, strokeWidth: 1.4 } as const;
  switch (kind) {
    case 'battles':
      return [
        roughLine(3, 17, 17, 3, { seed, ...ink }),
        roughLine(3, 3, 17, 17, { seed: seed + 1, ...ink }),
        roughLine(2, 14, 6, 18, { seed: seed + 2, ...ink, strokeWidth: 2 }),
        roughLine(14, 18, 18, 14, { seed: seed + 3, ...ink, strokeWidth: 2 }),
      ];
    case 'gems':
      return [
        roughPolygon(
          [
            [3, 8],
            [7, 3],
            [13, 3],
            [17, 8],
            [10, 18],
          ],
          {
            seed,
            stroke: color.inkRed,
            strokeWidth: 1.3,
            fill: color.inkRed,
            fillStyle: 'hachure',
            hachureGap: 2.4,
            fillWeight: 1,
          },
        ),
        roughLine(3, 8, 17, 8, { seed: seed + 1, stroke: color.inkRed, strokeWidth: 1 }),
      ];
    case 'buildings':
      return [
        roughPolygon(
          [
            [10, 19],
            [4, 9],
            [7, 3],
            [13, 3],
            [16, 9],
          ],
          {
            seed,
            ...ink,
            fill: color.inkSoft,
            fillStyle: 'hachure',
            hachureGap: 2.4,
            fillWeight: 0.9,
          },
        ),
        roughCircle(10, 8, 5, {
          seed: seed + 1,
          stroke: color.inkRed,
          strokeWidth: 1.3,
          fill: color.paper,
          fillStyle: 'solid',
        }),
      ];
  }
}

function StatRow({
  kind,
  value,
  label,
  seed,
}: {
  kind: Stat;
  value: number;
  label: string;
  seed: number;
}) {
  return (
    <View style={styles.stat}>
      <Svg width={20} height={20} viewBox="0 0 20 20">
        {statIcon(kind, seed).map((p, i) => (
          <RoughShape key={i} paths={p} />
        ))}
      </Svg>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatSave(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The account id over two lines, like the reference. */
function splitId(id: string): [string, string] {
  const mid = Math.ceil(id.length / 2);
  return [id.slice(0, mid), id.slice(mid)];
}

interface Side {
  title: string;
  status: string;
  fill: string;
  points: number;
  battles: number;
  gems: number;
  buildings: number;
  id: string;
  seedKey: string;
  onChoose: () => void;
}

function ProgressPanel({ side }: { side: Side }) {
  const progress = rankProgress(side.points);
  const [idA, idB] = splitId(side.id);
  const seed = hashString(`progress-${side.seedKey}`);
  return (
    <InkPanel
      w={PANEL.w}
      h={PANEL.h}
      seedKey={`progress-${side.seedKey}`}
      fill={side.fill}
      padding={space.sm}
    >
      <View style={styles.panelInner}>
        <Text style={styles.panelTitle}>{side.title}</Text>
        <Text style={styles.status}>{side.status}</Text>
        <RankBadge
          rank={progress.rank.name}
          current={progress.current}
          total={progress.total}
          seedKey={side.seedKey}
        />
        <View style={{ height: 4 }} />
        <StatRow kind="battles" value={side.battles} label="battles" seed={seed} />
        <StatRow kind="gems" value={side.gems} label="pcs" seed={seed + 10} />
        <StatRow kind="buildings" value={side.buildings} label="buildings" seed={seed + 20} />
        <Text style={styles.id}>
          ID: {idA}
          {'\n'}
          {idB}
        </Text>
        <InkButton
          label="Choose"
          tone="confirm"
          w={150}
          h={34}
          size="md"
          seedKey={`choose-${side.seedKey}`}
          onPress={side.onChoose}
        />
      </View>
    </InkPanel>
  );
}

export default function ProgressScreen() {
  const router = useRouter();
  const local = useProfile();
  const cloud = useCloud((s) => s.profile);

  // No conflict to resolve (deep link, or the cloud check never landed): move on.
  useEffect(() => {
    if (!cloud) router.replace('/menu');
  }, [cloud, router]);

  // Keeping the local profile: the identity columns go up (RLS allows those);
  // the local scores stay on the device — only the match server writes scores.
  const chooseLocal = useCallback(() => {
    const p = useProfile.getState();
    if (p.userId) void pushProfile(p.userId, localAsPatch(p as ProfileData));
    router.replace('/menu');
  }, [router]);

  const chooseCloud = useCallback(() => {
    const c = useCloud.getState().profile as CloudProfile | null;
    if (c) useProfile.getState().mergeRemote(cloudAsLocal(c));
    router.replace('/menu');
  }, [router]);

  if (!cloud) {
    return <Scale backgroundImage={BACKGROUNDS.identity} />;
  }

  const gap = 16;
  const left = (CANVAS_W - PANEL.w * 2 - gap) / 2;
  return (
    <Scale backgroundImage={BACKGROUNDS.identity}>
      <View style={styles.dim} pointerEvents="none" />
      <View style={styles.ribbon}>
        <TitleRibbon title="Choose game progress" w={420} h={40} size="md" />
      </View>
      <View style={{ position: 'absolute', left, top: 74, flexDirection: 'row', gap }}>
        <ProgressPanel
          side={{
            title: 'Local progress',
            status: 'Currently loaded',
            fill: WARM,
            points: local.rankPoints,
            battles: local.battlesPlayed,
            gems: local.gems,
            buildings: local.buildings,
            id: local.userId ?? 'this device',
            seedKey: 'local',
            onChoose: chooseLocal,
          }}
        />
        <ProgressPanel
          side={{
            title: 'Cloud progress',
            status: `last save: ${formatSave(cloud.updatedAt)}`,
            fill: COOL,
            points: cloud.rankPoints,
            battles: cloud.battlesPlayed,
            gems: cloud.gems,
            buildings: cloud.buildings,
            id: cloud.id,
            seedKey: 'cloud',
            onChoose: chooseCloud,
          }}
        />
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CANVAS_W,
    height: 360,
    backgroundColor: color.deskDark,
    opacity: 0.3,
  },
  ribbon: { position: 'absolute', left: (CANVAS_W - 420) / 2, top: 10 },
  panelInner: { alignItems: 'center', gap: 4, flex: 1 },
  panelTitle: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.md,
    textAlign: 'center',
  },
  status: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.sm,
    textAlign: 'center',
  },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 190 },
  statValue: { width: 44, color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  statLabel: {
    flex: 1,
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xs,
    textAlign: 'right',
  },
  id: {
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    textAlign: 'center',
    lineHeight: 13,
  },
});
