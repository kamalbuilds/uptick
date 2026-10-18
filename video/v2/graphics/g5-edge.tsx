export default function Graphic({ time, width, height }) {
  const C = { ink: "#0e0f0c", lime: "#9fe870", canvas: "#e8ebe6", mute: "#868685", line: "#2a2c27", panel: "#161814" };
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const title = ease((time - 0.4) / 0.5);
  const api = ease((time - 2.9) / 0.6);
  const cap = ease((time - 5.6) / 0.6);
  const vault = ease((time - 8.8) / 0.6);
  const fade = 1 - ease((time - 15.7) / 0.5);
  const card = (p, head, body) => (
    <div style={{ flex: 1, padding: 52, borderRadius: 32, minHeight: 380, boxSizing: "border-box", background: C.panel, border: `1px solid ${C.line}`, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
      <div style={{ color: C.mute, fontSize: 30, marginBottom: 24 }}>{head}</div>
      {body}
    </div>
  );
  return (
    <div style={{ width, height, background: C.ink, fontFamily: "Inter, sans-serif", padding: "110px 120px", boxSizing: "border-box", opacity: fade }}>
      <div style={{ color: C.canvas, fontSize: 104, fontWeight: 900, letterSpacing: -2, opacity: title }}>The edge is the evidence.</div>
      <div style={{ display: "flex", gap: 36, marginTop: 80 }}>
        {card(api, "Public evidence API", (
          <div style={{ color: C.canvas, fontSize: 36, lineHeight: 1.5, fontFamily: "Inter, sans-serif" }}>
            <div>GET /vaults/nvda</div>
            <div style={{ color: C.lime }}>gate: reduced</div>
            <div>fee 40.6% · kept -0.4%</div>
            <div>842,504 swaps</div>
          </div>
        ))}
        {card(cap, "Fee cap on hidden hook fees", (
          <div>
            <div style={{ color: C.lime, fontSize: 120, fontWeight: 900, letterSpacing: -3, lineHeight: 1 }}>200/200</div>
            <div style={{ color: C.canvas, fontSize: 34, marginTop: 18 }}>over-cap swaps stopped, mainnet fork</div>
          </div>
        ))}
        {card(vault, "Live NVDA vault, Robinhood Chain fork", (
          <div>
            <div style={{ color: C.lime, fontSize: 120, fontWeight: 900, letterSpacing: -3, lineHeight: 1 }}>$50,258</div>
            <div style={{ color: C.canvas, fontSize: 34, marginTop: 18 }}>233 NVDA in the pool, in band</div>
          </div>
        ))}
      </div>
    </div>
  );
}
