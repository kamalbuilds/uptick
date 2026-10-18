export default function Graphic({ time, width, height }) {
  const C = { ink: "#0e0f0c", lime: "#9fe870", canvas: "#e8ebe6", mute: "#868685" };
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const bg = ease(time / 0.4);
  const head = ease((time - 0.3) / 0.6);
  const mark = ease((time - 1.2) / 0.6);
  return (
    <div style={{ width, height, background: C.ink, opacity: bg, fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.canvas, fontSize: 112, fontWeight: 900, letterSpacing: -3, textAlign: "center", lineHeight: 1.02, opacity: head, transform: `translateY(${(1 - head) * 24}px)` }}>Put your stock tokens<br />to work.</div>
      <div style={{ marginTop: 64, display: "flex", alignItems: "center", gap: 28, opacity: mark }}>
        <div style={{ color: C.lime, fontSize: 64, fontWeight: 900, letterSpacing: -2 }}>Uptick</div>
        <div style={{ width: 1, height: 44, background: "#2a2c27" }} />
        <div style={{ color: C.mute, fontSize: 28 }}>Robinhood Chain · Arbitrum</div>
      </div>
    </div>
  );
}
