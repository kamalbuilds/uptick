#!/bin/sh
# Stack stills into one contact sheet: scripts/sheet.sh out/review/sheet.png <cols> <tile-width> a.png b.png ...
# ffmpeg comes from imageio-ffmpeg through uv (Remotion's own build has no tile filter).
OUT=$1; COLS=$2; W=$3; shift 3
F=$(uv run --quiet --with imageio-ffmpeg python3 -c "import imageio_ffmpeg as i; print(i.get_ffmpeg_exe())")
N=$#
ARGS=""; for f in "$@"; do ARGS="$ARGS -i $f"; done
ROWS=$(( (N + COLS - 1) / COLS ))
$F -v error -y $ARGS -filter_complex "concat=n=$N:v=1:a=0,scale=$W:-1,tile=${COLS}x${ROWS}:padding=6:color=0x333333" -frames:v 1 "$OUT"
