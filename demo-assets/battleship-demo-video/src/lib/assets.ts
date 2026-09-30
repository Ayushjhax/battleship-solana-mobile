import { loadFont } from '@remotion/fonts';
import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';

import { ASSETS, FONT_FAMILY } from '../config';

/** Bitter, bundled locally (public/fonts) so renders never depend on a CDN. */
export const fontsReady = Promise.all(
  (['600', '700', '800'] as const).map((weight) =>
    loadFont({
      family: FONT_FAMILY,
      url: staticFile(`fonts/bitter-latin-${weight}-normal.woff2`),
      weight,
      format: 'woff2',
    }),
  ),
);

/**
 * The website address, read from the supplied website.txt at render time so
 * the video can never show a retyped (or mistyped) URL.
 */
export function useWebsite(): { url: string; display: string } | null {
  const [site, setSite] = useState<{ url: string; display: string } | null>(null);
  const [handle] = useState(() => delayRender('Reading website.txt'));

  useEffect(() => {
    fetch(staticFile(ASSETS.website))
      .then((r) => r.text())
      .then((text) => {
        const url = text.trim();
        if (!/^https?:\/\/\S+$/.test(url)) throw new Error(`website.txt does not hold a URL: "${text}"`);
        setSite({ url, display: url.replace(/^https?:\/\//, '').replace(/\/$/, '') });
        continueRender(handle);
      })
      .catch((err) => cancelRender(err));
  }, [handle]);

  return site;
}
