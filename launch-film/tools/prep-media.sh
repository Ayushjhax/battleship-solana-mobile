#!/usr/bin/env bash
# Prepares every clip the film uses into public/media/ (gitignored):
#   constant 30 fps, H.264 yuv420p CRF 16, a keyframe every second (GOP 30), no audio,
#   and the last frame held for 10 s so any shot can run past the recording's end.
# Battle clips use the Real-ESRGAN 4× frames from tools/upscale.sh when they are complete,
# otherwise a Lanczos stand-in with identical timing (re-run this script when the upscale finishes).
# The wallet clip gets time-gated blurs over the address, the QR code and the tx signatures.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=../demo-assets
OUT=public/media
UP=${UPSCALE_DIR:-/tmp/claude-0/-home-user-battleship-solana-mobile/d399bcbf-2e1b-53b4-925b-adea1dc709b4/scratchpad/upscale}
mkdir -p "$OUT/stills"
ENC=(-c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -g 30 -keyint_min 30 -sc_threshold 0 -r 30 -an -movflags +faststart -color_primaries bt709 -color_trc bt709 -colorspace bt709)
HOLD="tpad=stop_mode=clone:stop_duration=10"

battle() { # name source start end
  local name=$1 file=$2 ss=$3 to=$4
  local n_in n_out
  n_in=$(ls "$UP/$name/in" 2>/dev/null | wc -l || echo 0)
  n_out=$(ls "$UP/$name/out" 2>/dev/null | wc -l || echo 0)
  if [ "$n_in" -gt 0 ] && [ "$n_in" = "$n_out" ]; then
    echo "  $name: ESRGAN ($n_out frames)"
    ffmpeg -v error -y -framerate 30 -i "$UP/$name/out/f%04d.png" -vf "$HOLD" "${ENC[@]}" "$OUT/${name}_x4.mp4"
  else
    echo "  $name: Lanczos stand-in (ESRGAN $n_out/$n_in)"
    ffmpeg -v error -y -ss "$ss" -to "$to" -i "$SRC/$file" -vf "fps=30,scale=5120:2304:flags=lanczos,$HOLD" "${ENC[@]}" "$OUT/${name}_x4.mp4"
  fi
}

phone() { # name source [start end]
  local name=$1 file=$2 ss=${3:-0} to=${4:-}
  local range=(-ss "$ss"); [ -n "$to" ] && range+=(-to "$to")
  ffmpeg -v error -y "${range[@]}" -i "$SRC/material/$file" -vf "fps=30,$HOLD" "${ENC[@]}" "$OUT/$name.mp4"
  echo "  $name"
}

echo "battle clips"
battle arsenal arsenal-attack.mp4 0 3.34
battle defense defense.mp4 0 2.74
battle base base-attack.mp4 1.5 6.58

echo "phone recordings"
phone buildyourbase buildyourbase.mp4
phone matchmaking matchmaking.mp4
phone buy_points buy_points.mp4
phone sell_points sell_points.mp4
phone store store.mp4

# Wallet: source 0.5–3.97 s (file t = source − 0.5), ending on the Activity tab, then held.
# Tab timing in the file (30 fps, measured on the lit tab button): Receive 0–22, Send 23–38, Activity 39+.
#   address under the balance: always           (x 330–1020, y 625–720)
#   QR + full address (Receive tab): t < 0.80   (x 1260–2530, y 460–900)
#   tx signatures (Activity tab): t ≥ 1.25      (x 1630–2190, y 490–980)
echo "wallet (blurred)"
ffmpeg -v error -y -ss 0.5 -to 3.97 -i "$SRC/material/wallet_profile.mp4" -filter_complex "
[0:v]fps=30,split=4[base][a][b][c];
[a]crop=690:95:330:625,boxblur=lr=20:lp=3:cr=10:cp=3[ab];
[b]crop=1270:440:1260:460,boxblur=lr=40:lp=3:cr=20:cp=3[bb];
[c]crop=560:490:1630:490,boxblur=lr=24:lp=3:cr=12:cp=3[cb];
[base][ab]overlay=330:625[v1];
[v1][bb]overlay=1260:460:enable='lt(t,0.80)'[v2];
[v2][cb]overlay=1630:490:enable='gte(t,1.25)',$HOLD[v]" -map "[v]" "${ENC[@]}" "$OUT/wallet.mp4"

echo "stills"
# leaderboard: the recording's real frames end at 0.97 s; take the settled table
ffmpeg -v error -y -i "$SRC/material/leaderboard.mp4" -vf "select=gte(t\,0.9)" -frames:v 1 -q:v 1 "$OUT/stills/leaderboard.jpg"
ffmpeg -v error -y -i "$OUT/arsenal_x4.mp4" -frames:v 1 -q:v 1 "$OUT/stills/arsenal_000.jpg"
ffmpeg -v error -y -i "$OUT/base_x4.mp4" -frames:v 1 -q:v 1 "$OUT/stills/base_aim.jpg"
ffmpeg -v error -y -ss 5.0 -i "$OUT/base_x4.mp4" -frames:v 1 -q:v 1 "$OUT/stills/victory_end.jpg"
ls -la "$OUT" "$OUT/stills"
