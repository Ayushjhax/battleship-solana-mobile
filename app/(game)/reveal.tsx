/**
 * The loser's winner's-base reveal — src/features/reveal/RevealScreen.tsx.
 * The battle opens it with the defeat screen's own params plus `reveal` (the
 * match's key); everything but `reveal` is handed on to /result untouched.
 */
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { RevealScreen } from '@/features/reveal/RevealScreen';

export default function RevealRoute() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  // Read once: one route instance's params never change, and the screen's
  // leave() should not see a new object on every render.
  const [route] = useState(() => {
    const resultParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (key !== 'reveal' && typeof value === 'string') resultParams[key] = value;
    }
    return { revealKey: typeof params.reveal === 'string' ? params.reveal : '', resultParams };
  });
  return <RevealScreen revealKey={route.revealKey} resultParams={route.resultParams} />;
}
