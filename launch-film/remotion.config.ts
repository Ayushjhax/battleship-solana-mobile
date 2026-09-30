/**
 * Remotion CLI config. Applies to `npx remotion render/still/studio` (not the Node APIs).
 * https://remotion.dev/docs/config
 */
import {Config} from '@remotion/cli/config';
import {existsSync} from 'node:fs';

// The sandbox can't download Remotion's headless shell; use the preinstalled one when present.
const PREINSTALLED = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
if (existsSync(PREINSTALLED)) {
  Config.setBrowserExecutable(PREINSTALLED);
}

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer('angle');
Config.setDelayRenderTimeoutInMilliseconds(120000);
