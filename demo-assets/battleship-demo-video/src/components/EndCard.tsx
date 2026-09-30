import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

import { ASSETS, COLOR, END_CARD, FONT_FAMILY } from '../config';
import { useWebsite } from '../lib/assets';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** 0 → 1 over a frame range; exactly 1 from its last frame onwards. */
const progress = (frame: number, range: readonly [number, number]) =>
  easeOut(interpolate(frame, range, [0, 1], clamp));

const BADGE = { w: 696, h: 273 };

/**
 * Availability card. Every entrance finishes by frame 779; from 780 to the
 * last frame nothing moves.
 */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const site = useWebsite();
  const E = END_CARD.enter;
  if (frame < E.logo[0]) return null;

  const logo = progress(frame, E.logo);
  const headline = progress(frame, E.headline);
  const badge = progress(frame, E.badge);
  const web = progress(frame, E.web);
  const rise = (p: number, px: number) => `translateY(${(1 - p) * px}px)`;

  const badgeW = BADGE.w * END_CARD.badgeScale;
  const badgeH = BADGE.h * END_CARD.badgeScale;

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 170 }}>
        <Img
          src={staticFile(ASSETS.logo)}
          style={{
            width: END_CARD.logoSize,
            height: END_CARD.logoSize,
            borderRadius: 44,
            boxShadow: `0 0 0 10px ${COLOR.paper}, 0 60px 140px rgba(0,0,12,0.65)`,
            opacity: logo,
            transform: `${rise(logo, 40)} scale(${0.94 + 0.06 * logo})`,
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', fontFamily: FONT_FAMILY }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 112,
              lineHeight: 1.1,
              color: COLOR.paper,
              whiteSpace: 'nowrap',
              letterSpacing: '-0.01em',
              opacity: headline,
              transform: rise(headline, 36),
            }}
          >
            {END_CARD.headline}
          </div>

          {/* the official badge, unaltered: native proportions, no filters */}
          <Img
            src={staticFile(ASSETS.badge)}
            style={{
              width: badgeW,
              height: badgeH,
              marginTop: 70,
              opacity: badge,
              transform: rise(badge, 36),
            }}
          />

          <div style={{ marginTop: 92, opacity: web, transform: rise(web, 36) }}>
            <div style={{ fontWeight: 600, fontSize: 68, lineHeight: 1.1, color: 'rgba(253,250,243,0.8)' }}>
              {END_CARD.webLabel}
            </div>
            <div
              style={{
                fontWeight: 800,
                fontSize: 138,
                lineHeight: 1.15,
                color: COLOR.paper,
                marginTop: 6,
                whiteSpace: 'nowrap',
              }}
            >
              {site?.display ?? ''}
            </div>
            {/* underline in the game's red ink */}
            <svg width="1180" height="34" viewBox="0 0 1180 34" style={{ display: 'block', marginTop: 4 }}>
              <path
                d="M6 22 C 220 10, 520 26, 780 16 S 1060 12, 1170 18"
                fill="none"
                stroke={COLOR.red}
                strokeWidth={10}
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
