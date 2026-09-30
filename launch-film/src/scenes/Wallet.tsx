import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Callout} from '../components/Callout';
import {Footage} from '../components/Footage';
import {KineticText} from '../components/KineticText';
import {PhoneFrame} from '../components/PhoneFrame';
import {COPY} from '../config/copy';
import {f, WALLET as B} from '../config/timeline';
import {cam} from '../lib/anim';
import {SAFE} from '../theme';

const SW = 2200; // screen width (0.82× the 2670 px recording)
const PX = 2340;
const PY = 1120;

/** "Connect. You're in." The Captain's wallet (addresses blurred at prep) in a generic handset. */
export const Wallet: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = cam(frame, 0, f(8));
  const k = SW / 2670;
  const sh = SW * (1200 / 2670);
  // "Privy embedded Solana wallet" panel title in the recording (2670-px coords ≈ (684, 292))
  const tx = PX - SW / 2 + 684 * k;
  const ty = PY - sh / 2 + 290 * k;
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <PhoneFrame screenWidth={SW} x={PX - 60 * drift} y={PY} at={-10} rotateY={-7 + 4 * drift} scale={1 + 0.03 * drift}>
        <Footage shot={B.screen} fit="cover" />
      </PhoneFrame>
      <Callout x={tx - 60 * drift} y={ty} dx={0} dy={-560} label={COPY.wallet.callout} at={f(B.callout)} />
      <div style={{position: 'absolute', left: SAFE.x + 40, top: 760}}>
        <KineticText text={COPY.wallet.word1} at={f(B.word1)} size="headline" align="left" />
      </div>
      <div style={{position: 'absolute', left: SAFE.x + 40, top: 980}}>
        <KineticText text={COPY.wallet.word2} at={f(B.word2)} size="headline" align="left" />
      </div>
    </AbsoluteFill>
  );
};
