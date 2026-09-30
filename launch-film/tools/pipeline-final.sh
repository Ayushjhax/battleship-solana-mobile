#!/usr/bin/env bash
# Unattended: wait for the Real-ESRGAN plates (battle clips + FX strips), prepare media, then the final render + master.
set -uo pipefail
cd "$(dirname "$0")/.."
UP=/tmp/claude-0/-home-user-battleship-solana-mobile/d399bcbf-2e1b-53b4-925b-adea1dc709b4/scratchpad/upscale
echo "[$(date +%T)] waiting for upscales"
until grep -q ALLDONE "$UP/log.txt" 2>/dev/null && grep -q FXDONE "$UP/fxlog.txt" 2>/dev/null; do sleep 30; done
echo "[$(date +%T)] upscales done; preparing media"
UPSCALE_DIR="$UP" tools/prep-media.sh
echo "[$(date +%T)] final render"
CONCURRENCY=3 tools/render-final.sh
echo "[$(date +%T)] PIPELINE DONE"
