import { describe, expect, test } from "bun:test";
import worker from "../src/worker";
import { ALERT_LIMITS, chainDeps, runAlerts, subscribe, unsubscribe, webhookProblem, type AlertDeps, type AlertsEnv, type Snapshot, type Subscription } from "../src/alerts";
import { BORROWER, ENTRY, VAULT, freshChain, fakeClient } from "./fake-chain";

/** An in-memory KV with the slice of the API the alerts code uses: get (text or json), put, delete and a paged, prefix-filtered list. */
class MemoryKV {
  data = new Map<string, string>();
  puts = 0;
  async get(key: string, type?: string) {
    const v = this.data.get(key);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) {
    this.puts++;
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async list({ prefix = "", cursor, limit = 1000 }: { prefix?: string; cursor?: string; limit?: number }) {
    const all = [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort();
    const from = cursor ? Number(cursor) : 0;
    const keys = all.slice(from, from + limit).map((name) => ({ name }));
    const done = from + limit >= all.length;
    return { keys, list_complete: done, cursor: done ? undefined : String(from + limit) };
  }
}

const MARKETS = { nvda: ENTRY };
const URL1 = "https://hooks.example.com/uptick/abc";
const ADDR = BORROWER;
const kvEnv = () => {
  const kv = new MemoryKV();
  return { kv, env: { ALERTS: kv as unknown as KVNamespace, VAULTS: JSON.stringify({ nvda: VAULT }) } as AlertsEnv };
};
const post = (path: string, body: unknown, ip = "203.0.113.7") =>
  new Request(`https://uptick.test${path}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) });
const sub = (over: Record<string, unknown> = {}) => ({ address: ADDR, vault: "nvda", threshold: 1.3, channel: "webhook", url: URL1, ...over });
const stored = (kv: MemoryKV): Subscription[] => [...kv.data.entries()].filter(([k]) => k.startsWith("a:")).map(([, v]) => JSON.parse(v));

describe("POST /alerts/subscribe", () => {
  test("stores an armed subscription and answers 201; the same triple again answers 200 and keeps one record", async () => {
    const { kv, env } = kvEnv();
    const res = await subscribe(post("/alerts/subscribe", sub()), env, MARKETS);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, armed: true, threshold: 1.3, vault: "nvda", address: ADDR });
    const [s] = stored(kv);
    expect(s).toMatchObject({ address: ADDR, vault: "nvda", threshold: 1.3, channel: "webhook", url: URL1, armed: true, failures: 0 });

    const again = await subscribe(post("/alerts/subscribe", sub({ threshold: 1.5 })), env, MARKETS);
    expect(again.status).toBe(200);
    expect(stored(kv).length).toBe(1);
    expect(stored(kv)[0].threshold).toBe(1.5);
  });

  test("refuses what it cannot watch: a bad address, an unknown vault, a vault without a market, a threshold out of range, another channel", async () => {
    const { env } = kvEnv();
    const fields = async (over: Record<string, unknown>) => {
      const res = await subscribe(post("/alerts/subscribe", sub(over)), env, MARKETS);
      expect(res.status).toBe(400);
      return ((await res.json()) as { field: string }).field;
    };
    expect(await fields({ address: "0x123" })).toBe("address");
    expect(await fields({ vault: "nope" })).toBe("vault");
    expect(await fields({ vault: "crcl" })).toBe("vault");
    expect(await fields({ threshold: 1.0 })).toBe("threshold");
    expect(await fields({ threshold: "1.3" })).toBe("threshold");
    expect(await fields({ threshold: 9 })).toBe("threshold");
    expect(await fields({ channel: "email" })).toBe("channel");
    expect(await fields({ url: "http://hooks.example.com/x" })).toBe("url");
  });

  test("with the markets the repo ships (none yet) no vault can be watched, and the reason names the market", async () => {
    const { env } = kvEnv();
    const res = await worker.fetch(post("/alerts/subscribe", sub()), env as never, {} as ExecutionContext);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/no Morpho market is configured for nvda/);
  });

  test("webhook URLs: https and a named public host only", () => {
    expect(webhookProblem(URL1)).toBeNull();
    for (const bad of ["http://a.example.com", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://[::1]/x", "https://localhost/x", "https://box.internal/x", "https://printer.local/x", "https://user:pw@a.example.com/x", "https://nodot/x", "ftp://a.example.com", "not a url", "", 5]) {
      expect(webhookProblem(bad)).not.toBeNull();
    }
    expect(webhookProblem(`https://a.example.com/${"x".repeat(ALERT_LIMITS.url)}`)).not.toBeNull();
  });

  test("caps subscriptions per wallet, and calls per IP", async () => {
    const { env } = kvEnv();
    for (let i = 0; i < ALERT_LIMITS.perWallet; i++) expect((await subscribe(post("/alerts/subscribe", sub({ url: `https://h${i}.example.com/x` })), env, MARKETS)).status).toBe(201);
    expect((await subscribe(post("/alerts/subscribe", sub({ url: "https://h9.example.com/x" })), env, MARKETS)).status).toBe(409);

    const other = kvEnv();
    let last = 0;
    for (let i = 0; i < ALERT_LIMITS.perWindow + 1; i++) {
      last = (await subscribe(post("/alerts/subscribe", sub({ address: `0x${(i + 1).toString(16).padStart(40, "0")}` }), "198.51.100.9"), other.env, MARKETS)).status;
    }
    expect(last).toBe(429);
  });

  test("answers 503 without the KV binding and 413 for a large body", async () => {
    expect((await subscribe(post("/alerts/subscribe", sub()), {}, MARKETS)).status).toBe(503);
    const { env } = kvEnv();
    expect((await subscribe(post("/alerts/subscribe", sub({ pad: "x".repeat(3000) })), env, MARKETS)).status).toBe(413);
  });

  test("unsubscribe needs the same address, vault and url", async () => {
    const { kv, env } = kvEnv();
    await subscribe(post("/alerts/subscribe", sub()), env, MARKETS);
    expect((await unsubscribe(post("/alerts/unsubscribe", { address: ADDR, vault: "nvda", url: "https://other.example.com/x" }), env)).status).toBe(404);
    expect(stored(kv).length).toBe(1);
    expect((await unsubscribe(post("/alerts/unsubscribe", { address: ADDR, vault: "nvda", url: URL1 }), env)).status).toBe(200);
    expect(stored(kv).length).toBe(0);
  });
});

/** A clock and a health the test moves, a fetch that records the webhooks it was asked to send. */
function harness(init: { health: number | null; status?: number }) {
  const { kv, env } = kvEnv();
  const t = { now: 1_800_000_000_000, health: init.health as number | null, status: init.status ?? 200, throws: false, readThrows: false };
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const deps: AlertDeps = {
    now: () => t.now,
    readHealth: async () => {
      if (t.readThrows) throw new Error("rpc down");
      return t.health === null ? null : ({ health: t.health, fields: { debt_usdg: "9000000000" } } satisfies Snapshot);
    },
    fetch: (async (url: string, init: RequestInit) => {
      if (t.throws) throw new Error("connection refused");
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response("ok", { status: t.status });
    }) as unknown as typeof fetch,
  };
  const run = () => runAlerts(env, deps);
  return { kv, env, t, calls, run };
}
const H = 3600_000;

describe("the scheduled run", () => {
  test("a crossing fires once, staying below does not fire again, recovery re-arms, and the next crossing fires after the refire window", async () => {
    const h = harness({ health: 1.8 });
    await subscribe(post("/alerts/subscribe", sub({ threshold: 1.3 })), h.env, MARKETS);

    // healthy: nothing
    expect(await h.run()).toMatchObject({ checked: 1, fired: 0 });
    expect(h.calls.length).toBe(0);

    // crossing: one webhook with the position in it
    h.t.health = 1.25;
    expect(await h.run()).toMatchObject({ fired: 1 });
    expect(h.calls.length).toBe(1);
    expect(h.calls[0].url).toBe(URL1);
    expect(h.calls[0].body).toMatchObject({ event: "loan_health_below_threshold", address: ADDR, vault: "nvda", threshold: 1.3, health_factor: 1.25, debt_usdg: "9000000000" });
    expect(stored(h.kv)[0].armed).toBe(false);

    // still below, for many runs and well past the refire window: it does not fire again
    for (let i = 0; i < 5; i++) {
      h.t.now += 2 * H;
      await h.run();
    }
    expect(h.calls.length).toBe(1);

    // recovery re-arms
    h.t.health = 1.5;
    expect(await h.run()).toMatchObject({ rearmed: 1, fired: 0 });
    expect(stored(h.kv)[0].armed).toBe(true);

    // a new crossing inside the refire window of the first webhook is held back, not lost
    h.t.now = stored(h.kv)[0].lastFiredAt! + 10 * 60_000;
    h.t.health = 1.2;
    expect(await h.run()).toMatchObject({ fired: 0, skipped: 1 });
    expect(h.calls.length).toBe(1);
    expect(stored(h.kv)[0].armed).toBe(true);

    // after the window it goes out
    h.t.now += ALERT_LIMITS.refireSeconds * 1000;
    expect(await h.run()).toMatchObject({ fired: 1 });
    expect(h.calls.length).toBe(2);
  });

  test("a failed webhook leaves the alert armed, retries after the backoff, and is not sent every run", async () => {
    const h = harness({ health: 1.1, status: 500 });
    await subscribe(post("/alerts/subscribe", sub()), h.env, MARKETS);
    expect(await h.run()).toMatchObject({ failed: 1, fired: 0 });
    expect(stored(h.kv)[0]).toMatchObject({ armed: true, failures: 1 });
    expect(h.calls.length).toBe(1);

    expect(await h.run()).toMatchObject({ skipped: 1 });
    expect(h.calls.length).toBe(1);

    h.t.status = 200;
    h.t.now += ALERT_LIMITS.retrySeconds * 1000 + 1;
    expect(await h.run()).toMatchObject({ fired: 1 });
    expect(stored(h.kv)[0]).toMatchObject({ armed: false, failures: 0 });

    const down = harness({ health: 1.1 });
    await subscribe(post("/alerts/subscribe", sub()), down.env, MARKETS);
    down.t.throws = true;
    expect(await down.run()).toMatchObject({ failed: 1 });
  });

  test("a wallet with no loan, or a chain that cannot be read, never fires", async () => {
    const none = harness({ health: null });
    await subscribe(post("/alerts/subscribe", sub()), none.env, MARKETS);
    expect(await none.run()).toMatchObject({ checked: 1, fired: 0 });

    const broken = harness({ health: 1.0 });
    await subscribe(post("/alerts/subscribe", sub()), broken.env, MARKETS);
    broken.t.readThrows = true;
    expect(await broken.run()).toMatchObject({ errors: 1, fired: 0 });
    expect(broken.calls.length).toBe(0);
  });

  test("a health factor equal to the threshold does not fire, one just under it does", async () => {
    const h = harness({ health: 1.3 });
    await subscribe(post("/alerts/subscribe", sub({ threshold: 1.3 })), h.env, MARKETS);
    expect(await h.run()).toMatchObject({ fired: 0 });
    h.t.health = 1.2999;
    expect(await h.run()).toMatchObject({ fired: 1 });
  });

  test("subscriptions beyond one run's budget are read by the next run, and every one is read", async () => {
    const h = harness({ health: 1.8 });
    const n = ALERT_LIMITS.perRun + 5;
    for (let i = 0; i < n; i++) {
      const key = `a:nvda:${i.toString().padStart(40, "0")}:x`;
      await h.kv.put(key, JSON.stringify({ address: ADDR, vault: "nvda", threshold: 1.3, channel: "webhook", url: URL1, createdAt: "", armed: true, nextAttemptAt: 0, failures: 0 }));
    }
    const first = await h.run();
    const second = await h.run();
    const third = await h.run();
    expect(first.checked).toBe(ALERT_LIMITS.perRun);
    expect(second.checked).toBe(5);
    expect(third.checked).toBe(ALERT_LIMITS.perRun);
    expect(first.checked + second.checked).toBe(n);
  });

  test("without the KV binding a run does nothing", async () => {
    expect(await runAlerts({})).toMatchObject({ checked: 0 });
  });
});

describe("the chain reader behind the scheduled run", () => {
  test("reads a position from the node and reports the health factor Morpho would compute, accrued to the block", async () => {
    const chain = freshChain();
    const env: AlertsEnv = { VAULTS: JSON.stringify({ nvda: VAULT }) };
    const { MARKETS: shipped } = await import("../src/loan-chain");
    shipped.nvda = ENTRY; // the repo ships no market yet; this gives the vault one for the read
    try {
      const deps = chainDeps(env, fakeClient(chain));
      const snap = await deps.readHealth("nvda", ADDR);
      expect(snap).not.toBeNull();
      // 100 shares at $200 = $20,000 of collateral, limit $12,500; $9,000 of shares at the stored ratio plus three days of interest at ~8%
      expect(snap!.health!).toBeGreaterThan(1.38);
      expect(snap!.health!).toBeLessThan(1.389);
      expect(Number(snap!.fields.debt_usdg)).toBeGreaterThan(9_000_000_000);

      chain.price = 150n * 10n ** 18n; // the share falls to $150: limit $9,375
      const lower = await chainDeps(env, fakeClient(chain)).readHealth("nvda", ADDR);
      expect(lower!.health!).toBeLessThan(1.05);

      expect(await deps.readHealth("nvda", "0x00000000000000000000000000000000000d0d04")).toBeNull();
      chain.market = null;
      await expect(chainDeps(env, fakeClient(chain)).readHealth("nvda", ADDR)).rejects.toThrow(/does not exist on-chain/);
    } finally {
      delete shipped.nvda;
    }
  });

  test("a run reads each vault's market once however many wallets watch it", async () => {
    const chain = freshChain();
    const { MARKETS: shipped } = await import("../src/loan-chain");
    shipped.nvda = ENTRY;
    try {
      const deps = chainDeps({ VAULTS: JSON.stringify({ nvda: VAULT }) }, fakeClient(chain));
      await deps.readHealth("nvda", ADDR);
      const afterFirst = chain.requests;
      await deps.readHealth("nvda", "0x00000000000000000000000000000000000d0d04");
      await deps.readHealth("nvda", "0x00000000000000000000000000000000000d0d05");
      expect(chain.requests - afterFirst).toBe(2); // one position read per wallet
    } finally {
      delete shipped.nvda;
    }
  });
});

describe("worker wiring", () => {
  test("exposes a scheduled handler that runs the alerts", async () => {
    expect(typeof (worker as { scheduled?: unknown }).scheduled).toBe("function");
  });
  test("the alerts routes take POST only", async () => {
    const res = await worker.fetch(new Request("https://uptick.test/alerts/subscribe"), {} as never, {} as ExecutionContext);
    expect(res.status).toBe(405);
  });
});
