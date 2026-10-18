export default function Graphic({ time, width, height }) {
  const C = { ink: "#0e0f0c", lime: "#9fe870" };
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const inP = ease(time / 0.5);
  const outP = 1 - ease((time - 4.1) / 0.4);
  const n = Math.round(5113049 * ease((time - 0.3) / 2.6));
  return (
    <div style={{ width, height, fontFamily: "Inter, sans-serif" }}>
      <div style={{ position: "absolute", left: 96, bottom: 88, display: "flex", alignItems: "baseline", gap: 18, padding: "22px 34px", borderRadius: 24, background: C.ink, opacity: inP * outP, transform: `translateY(${(1 - inP) * 24}px)` }}>
        <span style={{ color: C.lime, fontSize: 64, fontWeight: 900, letterSpacing: -1, fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString("en-US")}</span>
        <span style={{ color: "#e8ebe6", fontSize: 28 }}>trades replayed · 54 days</span>
      </div>
    </div>
  );
}
