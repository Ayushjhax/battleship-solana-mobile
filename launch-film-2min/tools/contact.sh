#!/usr/bin/env bash
# contact.sh <video> <name> <fps> <cols> <thumbwidth>
set -e
in="$1"; name="$2"; fps="${3:-1}"; cols="${4:-6}"; tw="${5:-480}"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
n=$(python3 -c "import math;print(max(1,math.ceil($dur*$fps)))")
rows=$(python3 -c "import math;print(max(1,math.ceil($n/$cols)))")
ffmpeg -v error -y -i "$in" -vf "fps=$fps,scale=$tw:-2,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='%{pts\:hms}':x=6:y=6:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=${cols}x${rows}:padding=4:color=0x222222" -frames:v 1 -q:v 3 "phase1/contact/${name}.jpg"
echo "phase1/contact/${name}.jpg ($n frames)"
