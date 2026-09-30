#!/usr/bin/env bash
# The final render, master and deliverables, in one command:  npm run final
#   1. LaunchFilm at 3840×2160 / 30 fps, H.264 CRF 16, BT.709 (with the mix as its audio)
#   2. extract the audio → two-pass ffmpeg loudnorm to −14 LUFS integrated / −1 dBTP
#   3. remux (video copied) with AAC 320 kb/s, 48 kHz stereo → out/EmpireOfBits_LaunchFilm_4K.mp4
#   4. 1920×1080 web version: Lanczos downscale of the master, CRF 18, same audio
#   5. poster (4K) + thumbnail (1280×720) from the lockup, and the ffprobe + loudness report
# Env: CONCURRENCY (default 3), CHUNK=frames per chunk (renders in chunks, joined with -c copy).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p out build/chunks
CONC=${CONCURRENCY:-3}
TOTAL=$(node --experimental-strip-types --no-warnings -e "import('./src/config/timeline.ts').then(t => console.log(t.DURATION_IN_FRAMES))")
CHUNK=${CHUNK:-0}
RAW=build/film_raw_4k.mp4

if [ "$CHUNK" -gt 0 ]; then
  # unstable renders: muted chunks joined with -c copy, then the mix is muxed in
  : > build/chunks/list.txt
  for ((s = 0; s < TOTAL; s += CHUNK)); do
    e=$((s + CHUNK - 1)); [ $e -ge $TOTAL ] && e=$((TOTAL - 1))
    part=build/chunks/part_$(printf %05d $s).mp4
    [ -f "$part" ] || npx remotion render src/index.ts LaunchFilm "$part" --frames=$s-$e --muted --codec=h264 --crf=16 --color-space=bt709 --concurrency=$CONC --props='{"audio":false}'
    echo "file '$(basename "$part")'" >> build/chunks/list.txt
  done
  ffmpeg -v error -y -f concat -safe 0 -i build/chunks/list.txt -c copy build/film_video_4k.mp4
  ffmpeg -v error -y -i build/film_video_4k.mp4 -i public/audio/mix.wav -map 0:v -map 1:a -c:v copy -c:a pcm_s24le -shortest build/film_raw_4k.mov
  RAW=build/film_raw_4k.mov
else
  npx remotion render src/index.ts LaunchFilm "$RAW" --codec=h264 --crf=16 --color-space=bt709 --concurrency=$CONC --audio-codec=aac --audio-bitrate=320k
fi

# ── master the audio: two-pass loudnorm → −14 LUFS / −1 dBTP ──
# Ceiling −1.5 dBTP leaves room for AAC's inter-sample overshoot; loudnorm falls back to its dynamic
# mode when linear can't hold the ceiling, so a final static trim lands the encoded file on −14.0.
ffmpeg -v error -y -i "$RAW" -vn -ac 2 -ar 48000 -c:a pcm_s24le build/film_audio.wav
J=$(ffmpeg -hide_banner -nostats -i build/film_audio.wav -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
P=$(echo "$J" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"measured_I={d['input_i']}:measured_TP={d['input_tp']}:measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:offset={d['target_offset']}\")")
ffmpeg -v error -y -i build/film_audio.wav -af "loudnorm=I=-14:TP=-1.5:LRA=11:$P:linear=true" -ar 48000 -c:a pcm_s24le build/film_audio_ln.wav
ffmpeg -v error -y -i build/film_audio_ln.wav -c:a aac -b:a 320k -ar 48000 -ac 2 build/film_audio_probe.m4a
I=$(ffmpeg -hide_banner -nostats -i build/film_audio_probe.m4a -af ebur128 -f null - 2>&1 | grep -A3 "Integrated loudness" | grep " I:" | awk '{print $2}')
TRIM=$(python3 -c "print(round(-14.0 - float('$I'), 2))")
ffmpeg -v error -y -i build/film_audio_ln.wav -af "volume=${TRIM}dB" -c:a pcm_s24le build/film_audio_master.wav

# ── deliverables ──
ffmpeg -v error -y -i "$RAW" -i build/film_audio_master.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -ar 48000 -ac 2 -movflags +faststart -shortest out/EmpireOfBits_LaunchFilm_4K.mp4
ffmpeg -v error -y -i out/EmpireOfBits_LaunchFilm_4K.mp4 -map 0:v -map 0:a -vf "scale=1920:1080:flags=lanczos" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a copy -movflags +faststart out/EmpireOfBits_LaunchFilm_1080p.mp4

POSTER=${POSTER_FRAME:-340}  # the title over the Atomic Bomber's strike, mid light-sweep
npx remotion still src/index.ts LaunchFilm out/poster.jpg --frame=$POSTER --jpeg-quality=95 --props='{"audio":false}'
ffmpeg -v error -y -i out/poster.jpg -vf "scale=1280:720:flags=lanczos" -q:v 2 out/thumbnail_1280x720.jpg

python3 tools/report.py
