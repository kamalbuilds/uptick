export default function Graphic({ time, width, height }) {
  const C = { ink: "#0e0f0c", lime: "#9fe870", canvas: "#e8ebe6", mute: "#868685", line: "#2a2c27" };
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const rise = ease(time / 0.7);
  const idle = ease((time - 3.8) / 0.5);
  const fade = 1 - ease((time - 8.4) / 0.5);
  return (
    <div style={{ width, height, background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", opacity: fade }}>
      <div style={{ width: 760, padding: 48, borderRadius: 32, background: "#161814", border: `1px solid ${C.line}`, opacity: rise, transform: `translateY(${(1 - rise) * 40}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 36, background: C.canvas, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 22 }}>NVDA</div>
          <div>
            <div style={{ color: C.canvas, fontSize: 34, fontWeight: 700 }}>NVIDIA Stock Token</div>
            <div style={{ color: C.mute, fontSize: 22, marginTop: 4 }}>Robinhood Chain wallet</div>
          </div>
        </div>
        <div style={{ height: 1, background: C.line, margin: "40px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ color: C.mute, fontSize: 26 }}>Earning</div>
          <div style={{ color: C.canvas, fontSize: 96, fontWeight: 900, letterSpacing: -2 }}>0.00%</div>
        </div>
        <div style={{ marginTop: 28, display: "inline-flex", padding: "10px 22px", borderRadius: 999, background: C.lime, color: C.ink, fontSize: 24, fontWeight: 700, opacity: idle, transform: `scale(${0.9 + 0.1 * idle})` }}>Sitting idle</div>
      </div>
    </div>
  );
}
