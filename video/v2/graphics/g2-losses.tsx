export default function Graphic({ time, width, height }) {
  const C = { ink: "#0e0f0c", lime: "#9fe870", canvas: "#e8ebe6", mute: "#868685", red: "#d03238", line: "#2a2c27" };
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const fees = ease((time - 0.6) / 2.2);
  const loss = ease((time - 5.9) / 2.4);
  const big = ease((time - 10.3) / 0.6);
  const fade = 1 - ease((time - 14.6) / 0.5);
  const bar = (label, value, frac, color, show) => (
    <div style={{ opacity: show, marginBottom: 44 }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: C.canvas, fontSize: 42, marginBottom: 18 }}>
        <span>{label}</span><span style={{ fontWeight: 800 }}>{value}</span>
      </div>
      <div style={{ height: 40, borderRadius: 20, background: "#1d1f1a", overflow: "hidden" }}>
        <div style={{ height: 40, width: `${frac * 100}%`, background: color, borderRadius: 20 }} />
      </div>
    </div>
  );
  return (
    <div style={{ width, height, background: C.ink, fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", opacity: fade }}>
      <div style={{ width: 1440, opacity: 1 - big, transform: `translateY(${-big * 80}px)` }}>
        <div style={{ color: C.mute, fontSize: 34, marginBottom: 48 }}>CRCL / USDG pool, replayed over 30 days, per year</div>
        {bar("Fees earned", "+170.7%", fees * 0.46, C.lime, Math.min(1, fees * 3))}
        {bar("Lost to fast traders", "-201.3%", loss * 0.54, C.red, Math.min(1, loss * 3))}
      </div>
      <div style={{ position: "absolute", textAlign: "center", opacity: big, transform: `scale(${0.92 + 0.08 * big})` }}>
        <div style={{ color: C.red, fontSize: 280, fontWeight: 900, letterSpacing: -6, lineHeight: 1 }}>-78.5%</div>
        <div style={{ color: C.canvas, fontSize: 44, marginTop: 24 }}>kept by liquidity providers, a year</div>
      </div>
    </div>
  );
}
