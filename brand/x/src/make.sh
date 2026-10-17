#!/bin/bash
# Rebuild every brand/x PNG from source, then run the pixel checks. Needs Brave's CDP on 9396.
# python3 capture_app.py refreshes app-band-card.png from the running app first, when the app has changed.
set -e
cd "$(dirname "$0")"
P=/opt/homebrew/bin/python3
$P build.py
$P render.py avatar.svg ../avatar-400.png 400 400 --no-text
$P render.py banner.svg ../banner.png 1500 500 --min-font 20
$P render.py og.svg ../og.png 1200 630 --min-font 20
for f in post-1-sessions post-2-hooks post-3-cap post-4-app; do
  $P render.py $f.svg ../$f.png 1600 900 --min-font 20
done
$P check.py ..
