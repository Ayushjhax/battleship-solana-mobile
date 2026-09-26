#!/bin/bash
# The Captain's wallet art, derived from assets/captains_wallet_ui_assets_transparent/
# (and the profile banner). Needs ImageMagick 7. Run by scripts/color-assets.sh
# (npm run assets), or on its own. Output: assets/wallet/.
#
# The source pieces are crops of the reference screens, so most carry sample
# text (a placeholder, a balance, a transaction). The app draws live text, so:
#  - panel-*.png: the send panel's frame with its contents painted out in its
#    paper, rebuilt (nine-slice) at the exact size each panel is drawn at
#  - tab*.png, send-button.png, field-*.png, row.png: the blank plates — the
#    baked label covered with the plate's own fill (quilt), then nine-sliced
#    to the aspect the screen draws them at
#  - banner.png: the profile's ribbon with its title painted out
#  - icon-*.png: the separate icons with the pale haze they were cut with
#    removed, so they sit cleanly on a tinted plate
#  - btn-*.png, heading-*.png, footer-*.png: used as drawn (labels that never
#    change), trimmed
set -euo pipefail
cd "$(dirname "$0")/.."
W=assets/captains_wallet_ui_assets_transparent
OUT=assets/wallet
mkdir -p "$OUT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PAPER="#FBFAF4"

# quilt <src> <out> <box x0 y0 x1 y1> <patch a x0 x1> <patch b x0 x1> — as in
# battle-assets.sh: the box covered with strips of the plate's own fill taken
# from beside it on the same rows, cross-faded, feathered into the plate.
quilt() {
  local f=$1 out=$2 x0=$3 y0=$4 x1=$5 y1=$6 a0=$7 a1=$8 b0=$9 b1=${10}
  local bw=$((x1 - x0)) bh=$((y1 - y0)) ov=10 x=0 k=0 p0 p1 pw
  magick -size "${bw}x${bh}" xc:none "PNG32:$TMP/q.png"
  while [ "$x" -lt "$bw" ]; do
    if [ $((k % 2)) = 0 ]; then p0=$a0; p1=$a1; else p0=$b0; p1=$b1; fi
    pw=$((p1 - p0))
    magick "$f" -crop "${pw}x${bh}+${p0}+${y0}" +repage \
      \( -size "${ov}x${bh}" -define gradient:direction=East gradient:black-white \
         -size "$((pw - ov))x${bh}" xc:white +append \) \
      -alpha off -compose copy_opacity -composite "PNG32:$TMP/qp.png"
    [ "$x" = 0 ] && magick "$f" -crop "${pw}x${bh}+${p0}+${y0}" +repage "PNG32:$TMP/qp.png"
    magick "$TMP/q.png" "$TMP/qp.png" -geometry "+${x}+0" -compose over -composite +geometry "PNG32:$TMP/q.png"
    x=$((x + pw - ov)); k=$((k + 1))
  done
  magick "$TMP/q.png" \( -size "${bw}x${bh}" xc:black -fill white -draw "rectangle 3,3 $((bw - 4)),$((bh - 4))" -blur 0x2 \) \
    -alpha off -compose copy_opacity -composite "PNG32:$TMP/qm.png"
  magick "$f" "$TMP/qm.png" -geometry "+${x0}+${y0}" -compose over -composite +geometry "PNG32:$out"
}

# nine <src> <out> <out w> <out h> <corner px> — as in battle-assets.sh.
nine() {
  local f=$1 out=$2 OW=$3 OH=$4 c=$5 W H mw mh ow oh
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  mw=$((W - 2 * c)); mh=$((H - 2 * c)); ow=$((OW - 2 * c)); oh=$((OH - 2 * c))
  magick -size "${OW}x${OH}" xc:none \
    \( "$f" -crop "${c}x${c}+0+0" +repage \) -geometry +0+0 -composite \
    \( "$f" -crop "${mw}x${c}+${c}+0" +repage -resize "${ow}x${c}!" \) -geometry "+${c}+0" -composite \
    \( "$f" -crop "${c}x${c}+$((W - c))+0" +repage \) -geometry "+$((OW - c))+0" -composite \
    \( "$f" -crop "${c}x${mh}+0+${c}" +repage -resize "${c}x${oh}!" \) -geometry "+0+${c}" -composite \
    \( "$f" -crop "${mw}x${mh}+${c}+${c}" +repage -resize "${ow}x${oh}!" \) -geometry "+${c}+${c}" -composite \
    \( "$f" -crop "${c}x${mh}+$((W - c))+${c}" +repage -resize "${c}x${oh}!" \) -geometry "+$((OW - c))+${c}" -composite \
    \( "$f" -crop "${c}x${c}+0+$((H - c))" +repage \) -geometry "+0+$((OH - c))" -composite \
    \( "$f" -crop "${mw}x${c}+${c}+$((H - c))" +repage -resize "${ow}x${c}!" \) -geometry "+${c}+$((OH - c))" -composite \
    \( "$f" -crop "${c}x${c}+$((W - c))+$((H - c))" +repage \) -geometry "+$((OW - c))+$((OH - c))" -composite \
    +geometry -strip "$out"
}

# trim_art <src> <out> [max px]: cropped to where the alpha is over 3 %.
trim_art() {
  local f=$1 out=$2 max=${3:-0} box
  box=$(magick "$f" -alpha extract -threshold 3% -format '%@' info:)
  if [ "$max" != 0 ]; then
    magick "$f" -crop "$box" +repage -resize "${max}x${max}>" -strip "$out"
  else
    magick "$f" -crop "$box" +repage -strip "$out"
  fi
}

# The screen's sizes, in canvas units x 3 (app/wallet.tsx keeps them in step).
echo "wallet: panels"
magick "$W/send/full_send_panel.png" -fill "$PAPER" -draw "rectangle 33,35 1351,769" "PNG32:$TMP/panel.png"
nine "$TMP/panel.png" "$OUT/panel-left.png" 954 870 72
nine "$TMP/panel.png" "$OUT/panel-right.png" 1290 870 72

echo "wallet: banner"
quilt assets/images/profile/captains-profile-banner.png "$TMP/banner.png" 140 27 522 96 96 140 522 566
magick "$TMP/banner.png" -strip "$OUT/banner.png"

echo "wallet: plates"
quilt "$W/wallet/copy_button.png" "$TMP/tab.png" 100 18 395 132 20 95 400 500
nine "$TMP/tab.png" "$OUT/tab.png" 384 111 30
quilt "$W/send/review_send_button.png" "$TMP/green.png" 60 16 498 133 27 58 499 522
nine "$TMP/green.png" "$OUT/tab-on.png" 384 111 30
nine "$TMP/green.png" "$OUT/send-button.png" 540 120 30
quilt "$W/send/recipient_field.png" "$TMP/rf.png" 40 18 1175 127 420 700 700 1060
nine "$TMP/rf.png" "$OUT/field-recipient.png" 1188 114 30
quilt "$W/send/amount_field.png" "$TMP/af.png" 40 17 600 138 290 440 440 600
nine "$TMP/af.png" "$OUT/field-amount.png" 600 114 30
quilt "$W/activity/confirmed_row_01.png" "$TMP/row.png" 30 19 1295 136 428 494 1258 1298
nine "$TMP/row.png" "$OUT/row.png" 1170 84 28

echo "wallet: icons (haze removed: only the ink is kept)"
icon() {
  magick "$1" -channel A -fx 'a*(1-min(1,max(0,(lightness-0.62)/0.22)))' +channel "PNG32:$TMP/icon.png"
  trim_art "$TMP/icon.png" "$OUT/icon-$2.png" 160
}
icon "$W/wallet/copy_icon.png" copy
icon "$W/wallet/address_copy_icon.png" address-copy
icon "$W/wallet/external_link_icon.png" link
icon "$W/wallet/refresh_icon.png" refresh
icon "$W/wallet/signature_icon.png" sign
icon "$W/send/send_icon.png" send
icon "$W/send/scan_icon.png" scan
icon "$W/activity/chevron_icon.png" chevron
icon "$W/activity/confirmed_icon.png" confirmed
trim_art "$W/wallet/status_connected_dot.png" "$OUT/icon-dot.png" 96

echo "wallet: labelled buttons, headings, footer"
trim_art "$W/wallet/copy_button.png" "$OUT/btn-copy.png" 420
trim_art "$W/wallet/explorer_button.png" "$OUT/btn-explorer.png" 420
trim_art "$W/wallet/refresh_button.png" "$OUT/btn-refresh.png" 420
trim_art "$W/wallet/sign_proof_button.png" "$OUT/btn-sign.png" 420
trim_art "$W/receive/copy_address_button.png" "$OUT/btn-copy-address.png" 660
trim_art "$W/receive/receive_sol_heading.png" "$OUT/heading-receive.png" 420
trim_art "$W/send/send_sol_heading.png" "$OUT/heading-send.png" 420
trim_art "$W/activity/recent_activity_heading.png" "$OUT/heading-activity.png" 480
magick "$W/activity/network_footer.png" -crop 330x52+0+0 +repage "PNG32:$TMP/fl.png"
trim_art "$TMP/fl.png" "$OUT/footer-left.png"
magick "$W/activity/network_footer.png" -crop 351x52+705+0 +repage "PNG32:$TMP/fr.png"
trim_art "$TMP/fr.png" "$OUT/footer-right.png"

# The painted plates are mostly hatching noise, which PNG stores badly.
for n in panel-left panel-right banner tab tab-on send-button field-recipient field-amount row; do
  magick "$OUT/$n.png" -quality 90 -define webp:alpha-quality=100 -define webp:method=6 "$OUT/$n.webp"
  rm "$OUT/$n.png"
done
for f in "$OUT"/*.png "$OUT"/*.webp; do printf '  %-24s %s\n' "$(basename "$f")" "$(magick identify -format '%wx%h' "$f")"; done
echo "  $(ls "$OUT" | wc -l | tr -d ' ') wallet files, $(du -sh "$OUT" | cut -f1)"
