export default function Graphic({ time, width, height }) {
  const C = { ink: "#0e0f0c", lime: "#9fe870", canvas: "#e8ebe6", mute: "#868685", line: "#2a2c27" };
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const rows = [
    { at: 0.5, big: "Arbitrum", small: "Robinhood Chain is built on it" },
    { at: 3.7, big: "189,012", small: "wallets hold NVDA Stock Tokens" },
    { at: 9.8, big: "$523M", small: "in Robinhood Earn, from 73,900 holders" },
  ];
  const fade = 1 - ease((time - 17.2) / 0.5);
  return (
    <div style={{ width, height, background: C.ink, fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", paddingLeft: 180, opacity: fade }}>
      <div>
        {rows.map((r) => {
          const p = ease((time - r.at) / 0.6);
          return (
            <div key={r.big} style={{ display: "flex", alignItems: "baseline", gap: 36, padding: "26px 0", borderBottom: `1px solid ${C.line}`, opacity: p, transform: `translateX(${(1 - p) * -40}px)` }}>
              <div style={{ width: 520, color: C.lime, fontSize: 120, fontWeight: 900, letterSpacing: -4, lineHeight: 1 }}>{r.big}</div>
              <div style={{ color: C.canvas, fontSize: 38, maxWidth: 760 }}>{r.small}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
