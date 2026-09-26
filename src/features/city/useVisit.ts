/**
 * One PortCityVisit per mount of the city screen, wired to the things that
 * pause it: the screen's focus and the app going to the background. Unmounting
 * detaches it, which drops every timer; the next visit is a new instance.
 */
import { useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { PortCityVisit, type ExitReason, type VisitSnapshot } from './visit';

const isForeground = (state: AppStateStatus) => state !== 'background' && state !== 'inactive';

export function useVisit(opts: {
  onExit: (reason: ExitReason) => void;
  popupEnterMs: number;
  exitMs: number;
}): [PortCityVisit, VisitSnapshot] {
  const onExit = useRef(opts.onExit);
  useLayoutEffect(() => {
    onExit.current = opts.onExit;
  });

  const [visit] = useState(
    () =>
      new PortCityVisit({
        onExit: (reason) => onExit.current(reason),
        popupEnterMs: opts.popupEnterMs,
        exitMs: opts.exitMs,
      }),
  );

  useEffect(() => {
    visit.attach();
    return () => visit.detach();
  }, [visit]);

  useEffect(() => {
    visit.setAppActive(isForeground(AppState.currentState));
    const sub = AppState.addEventListener('change', (state) =>
      visit.setAppActive(isForeground(state)),
    );
    return () => sub.remove();
  }, [visit]);

  useFocusEffect(
    useCallback(() => {
      visit.setFocused(true);
      return () => visit.setFocused(false);
    }, [visit]),
  );

  const snapshot = useSyncExternalStore(visit.subscribe, visit.getSnapshot, visit.getSnapshot);
  return [visit, snapshot];
}
