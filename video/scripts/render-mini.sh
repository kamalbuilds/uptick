#!/usr/bin/env bash
# Sync to the Mac mini, render under the shared mini render lock, watch disk (keep >= 25 GB free), copy the mp4 back, clean up.
set -euo pipefail
cd "$(dirname "$0")/.."
MINI=mini-ts; MD=uptick-video; LOCK=/tmp/cwf-film-render.lock
rsync -a --delete --exclude node_modules --exclude out --exclude vo/raw --exclude vo/norm --exclude capture ./ "$MINI:$MD/"
ssh "$MINI" "while ! mkdir $LOCK 2>/dev/null; do if [ -n \"\$(find $LOCK -maxdepth 0 -mmin +25 2>/dev/null)\" ]; then rmdir $LOCK; fi; sleep 5; done"
trap 'ssh "$MINI" "rmdir $LOCK" 2>/dev/null || true' EXIT
ssh "$MINI" 'df -g / | tail -1 | awk "{print \"mini free GB before:\", \$4}"'
ssh "$MINI" "export PATH=/opt/homebrew/bin:\$PATH; cd $MD && ( while sleep 20; do f=\$(df -g / | tail -1 | awk '{print \$4}'); echo \"free \$f\" >> /tmp/uptick-df.log; if [ \"\$f\" -lt 25 ]; then pkill -f 'remotion render' ; echo ABORT >> /tmp/uptick-df.log; fi; done ) & W=\$!; node_modules/.bin/remotion render src/index.ts Film /tmp/uptick-explainer.mp4 --public-dir=public --codec=h264 --hardware-acceleration=if-possible --video-bitrate=8M --audio-codec=aac --concurrency=9 --log=error; kill \$W"
mkdir -p out
scp -q "$MINI:/tmp/uptick-explainer.mp4" out/uptick-explainer.mp4
ssh "$MINI" "rm -f /tmp/uptick-explainer.mp4; df -g / | tail -1 | awk '{print \"mini free GB after:\", \$4}'"
