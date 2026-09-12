/** The scripted demo match from the hidden demo menu — see src/features/demo/demoMatch.ts. */
import { useRef } from 'react';

import { BattleScreen } from './battle';
import { buildDemoSetup } from '@/features/demo/demoMatch';
import { useProfile } from '@/state/profile';

export default function DemoBattleRoute() {
  // Built once on mount: the fleet is fixed, and the battle starts from it once.
  const setup = useRef(buildDemoSetup(useProfile.getState()));
  return <BattleScreen setup={setup.current} />;
}
