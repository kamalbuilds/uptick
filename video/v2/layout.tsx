// Uptick launch film layout. Run: cb source apply "Uptick launch film" layout.tsx --eval
// Narration is laid back to back (0.35 s between lines, 0.8 s between beats); every visual spans its beat.
const VO: [string, number, number][] = [
  ["vo01.wav", 2.84, 1], ["vo02.wav", 4.4, 1],
  ["vo03.wav", 5.0, 2], ["vo04.wav", 4.08, 2], ["vo05.wav", 4.24, 2],
  ["vo06.wav", 2.76, 3], ["vo07.wav", 4.6, 3], ["vo08.wav", 3.72, 3],
  ["vo09.wav", 5.96, 4], ["vo10.wav", 3.28, 4], ["vo11.wav", 3.12, 4], ["vo12.wav", 4.76, 4],
  ["vo13.wav", 2.84, 5], ["vo14.wav", 5.72, 5], ["vo15.wav", 7.32, 5],
  ["vo16.wav", 2.16, 6], ["vo17.wav", 5.56, 6], ["vo18.wav", 6.68, 6],
  ["vo19.wav", 2.48, 7],
];
const LEAD = 0.6;
let t = LEAD;
let prevBeat = 1;
const lines: { src: string; start: number; end: number; beat: number }[] = [];
for (const [src, dur, beat] of VO) {
  if (beat !== prevBeat) t += 0.8;
  lines.push({ src, start: +t.toFixed(2), end: +(t + dur).toFixed(2), beat });
  t += dur + 0.35;
  prevBeat = beat;
}
const END = +(t + 2.2).toFixed(2);
const beat = (n: number) => {
  const ls = lines.filter((l) => l.beat === n);
  const start = n === 1 ? 0 : +(ls[0].start - 0.4).toFixed(2);
  const next = lines.find((l) => l.beat === n + 1);
  const end = next ? +(next.start - 0.4).toFixed(2) : END;
  return { start, end };
};
const b = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i === 0 ? { start: 0, end: 0 } : beat(i)));
const b4a = { start: b[4].start, end: +(b[4].start + 4.6).toFixed(2) };
const b4b = { start: b4a.end, end: +(b4a.end + 7.4).toFixed(2) };
const b4c = { start: b4b.end, end: b[4].end };

export default (
  <timeline aspect="16:9">
    <track kind="video" name="Graphics">
      <code name="Idle NVDA in a wallet" start={b[1].start} end={b[1].end} pending />
      <code name="Pools lose to fast traders, -78.5%" start={b[2].start} end={b[2].end} pending />
      <code name="5.1 million trades replayed" start={b4a.start} end={b4a.end} pending />
      <code name="Arbitrum, 189,012 holders, $523M Earn" start={b[5].start} end={b[5].end} pending />
      <code name="Evidence API, fee cap, live fork vault" start={b[6].start} end={b[6].end} pending />
      <code name="End card: Put your stock tokens to work" start={+(b[7].start + 1.2).toFixed(2)} end={b[7].end} pending />
    </track>
    <track kind="video" name="App footage">
      <clip name="Deposit 10 NVDA" src="f2-deposit.mp4" start={b[3].start} end={b[3].end} in={0} />
      <clip name="Vaults: open, reduced, closed" src="f1-vaults.mp4" start={b4a.start} end={b4a.end} in={0} />
      <clip name="What you earn and what you keep" src="f3-evidence.mp4" start={b4b.start} end={b4b.end} in={1.2} />
      <clip name="CRCL: deposits closed, with the reason" src="f4-closed.mp4" start={b4c.start} end={b4c.end} in={0} />
      <clip name="Home: Put your stock tokens to work" src="f6-home.mp4" start={b[7].start} end={b[7].end} in={0} />
    </track>
    <track kind="audio" name="Narration">
      {lines.map((l) => <audio name={l.src.replace(".wav", "")} src={l.src} start={l.start} end={l.end} volume={100} />)}
    </track>
  </timeline>
);
