#!/usr/bin/env bash
# Copies the game art and fonts the film uses into public/ (read-only use of the game's files).
set -euo pipefail
cd "$(dirname "$0")/.."
R=..
mkdir -p public/fonts public/art/fleet public/art/weapons public/art/fx public/art/ui
cp node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2 node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2 public/fonts/
cp $R/demo-assets/battleship-demo-video/public/fonts/bitter-latin-{600,700,800}-normal.woff2 $R/demo-assets/battleship-demo-video/public/fonts/OFL-Bitter.txt public/fonts/
for s in battleship cruiser destroyer boat; do
  cp $R/assets/store/purple/fleet/$s.png public/art/fleet/$s.png
  cp $R/assets/store/crimson/fleet/$s.png public/art/fleet/$s-crimson.png
  cp $R/assets/store/emerald/fleet/$s.png public/art/fleet/$s-emerald.png
done
for w in bomber torpedo-bomber double-torpedo atomic-bomber submarine; do cp $R/assets/store/purple/attack/$w.png public/art/weapons/; done
for w in aa-gun mine radar; do cp $R/assets/store/purple/defence/$w.png public/art/weapons/; done
cp $R/assets/fx/*.webp public/art/fx/
cp $R/demo-assets/solana-badge.png $R/assets/result/victory-banner.png $R/assets/searching/radar-base.png $R/assets/searching/radar-sweep.png $R/assets/images/battle-screen/empire-ocean-logo.png public/art/ui/
cp $R/assets/port_city_assets/backgrounds_and_reference/port_city_map_background.png public/art/ui/port-city-map.png
echo "art staged: $(du -sh public/art | cut -f1)"
