import { describe, expect, test } from "bun:test";
import worker from "../src/worker";
import { TALK_LIMITS } from "../src/talk";

const ctx = {} as ExecutionContext;

/** In-memory KV with the real list contract: sorted keys, a cursor, list_complete. Page size 2 forces the count loop to paginate. */
class FakeKV {
  store = new Map<string, string>();
  ttl = new Map<string, number | undefined>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, opts?: { expirationTtl?: number }) {
    this.store.set(key, value);
    this.ttl.set(key, opts?.expirationTtl);
  }
  async list({ prefix = "", cursor }: { prefix?: string; cursor?: string }) {
    const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const slice = keys.slice(start, start + 2);
    const done = start + 2 >= keys.length;
    return { keys: slice.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + 2) };
  }
}

const good = {
  holds: "NVDA, about $3k of it",
  today: "It sits in my wallet",
  blocker: "I do not trust a range I cannot watch",
  yield: "8% kept after losses",
  loi: "maybe",
  handle: "@someone",
  consent: true,
};

function setup() {
  const kv = new FakeKV();
  const env = { TALK: kv as unknown as KVNamespace, TALK_SALT: "test-salt" };
  const post = (body: unknown, ip = "203.0.113.7", raw?: string) =>
    worker.fetch(
      new Request("https://uptick-evidence.test/talk", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: raw ?? JSON.stringify(body),
      }),
      env,
      ctx,
    );
  const count = async () => (await (await worker.fetch(new Request("https://uptick-evidence.test/talk/count"), env, ctx)).json()) as unknown;
  const submissions = () => [...kv.store.entries()].filter(([k]) => k.startsWith("s:")).map(([, v]) => JSON.parse(v) as Record<string, unknown>);
  return { kv, env, post, count, submissions };
}

describe("POST /talk", () => {
  test("stores one answer set and strips the @ from the handle", async () => {
    const t = setup();
    const res = await t.post(good);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });

    const rows = t.submissions();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      holds: good.holds,
      today: good.today,
      blocker: good.blocker,
      yield: good.yield,
      loi: "maybe",
      handle: "someone",
    });
    expect(typeof rows[0].at).toBe("string");
  });

  test("stores nothing beyond the answers: no IP, no consent flag, no unknown fields", async () => {
    const t = setup();
    await t.post({ ...good, extra: "ignored", ip: "198.51.100.9" }, "198.51.100.9");
    const dump = JSON.stringify([...t.kv.store.entries()]);
    expect(dump).not.toContain("198.51.100.9");
    expect(dump).not.toContain("ignored");
    expect(Object.keys(t.submissions()[0]).sort()).toEqual(["at", "blocker", "handle", "holds", "loi", "today", "yield"]);
  });

  test("the handle is optional and stored as null", async () => {
    const t = setup();
    const { handle: _drop, ...noHandle } = good;
    expect((await t.post(noHandle)).status).toBe(201);
    expect(t.submissions()[0].handle).toBeNull();
  });

  test("rejects each missing or blank required field and stores nothing", async () => {
    const t = setup();
    for (const field of ["holds", "today", "blocker", "yield", "loi", "consent"]) {
      const body: Record<string, unknown> = { ...good };
      delete body[field];
      const res = await t.post(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { field: string }).field).toBe(field);
    }
    const blank = await t.post({ ...good, holds: "   " });
    expect(blank.status).toBe(400);
    expect(t.submissions().length).toBe(0);
  });

  test("caps every field: the limit passes, one over is a 400", async () => {
    for (const field of ["holds", "today", "blocker", "yield", "handle"] as const) {
      const t = setup();
      const limit = TALK_LIMITS[field];
      const at = await t.post({ ...good, [field]: "a".repeat(limit) });
      expect(at.status).toBe(201);
      const over = await t.post({ ...good, [field]: "a".repeat(limit + 1) }, "203.0.113.99");
      expect(over.status).toBe(400);
      expect(((await over.json()) as { field: string }).field).toBe(field);
      expect(t.submissions().length).toBe(1);
    }
  });

  test("rejects consent that is not literally true, bad loi, bad handle, non-object and invalid JSON", async () => {
    const t = setup();
    expect((await t.post({ ...good, consent: "true" })).status).toBe(400);
    expect((await t.post({ ...good, consent: false })).status).toBe(400);
    expect((await t.post({ ...good, loi: "definitely" })).status).toBe(400);
    expect((await t.post({ ...good, handle: "has space" })).status).toBe(400);
    expect((await t.post({ ...good, handle: "a@b.com" })).status).toBe(400);
    expect((await t.post([good])).status).toBe(400);
    expect((await t.post(null, "203.0.113.7", "{not json")).status).toBe(400);
    expect((await t.post({ ...good, holds: 5 })).status).toBe(400);
    expect(t.submissions().length).toBe(0);
  });

  test("a body over the body cap is refused with 413", async () => {
    const t = setup();
    const res = await t.post({ ...good, holds: "a".repeat(TALK_LIMITS.body + 1) });
    expect(res.status).toBe(413);
    expect(t.submissions().length).toBe(0);
  });

  test("rate limit: three per IP per window, the fourth is a 429 with retry-after, another IP still passes", async () => {
    const t = setup();
    for (let i = 0; i < TALK_LIMITS.perWindow; i++) expect((await t.post(good)).status).toBe(201);
    const blocked = await t.post(good);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe(String(TALK_LIMITS.windowSeconds));
    expect(t.submissions().length).toBe(TALK_LIMITS.perWindow);

    expect((await t.post(good, "203.0.113.8")).status).toBe(201);
    expect(t.submissions().length).toBe(TALK_LIMITS.perWindow + 1);
  });

  test("rate-limit key is a hash with a TTL, never the raw IP", async () => {
    const t = setup();
    await t.post(good, "198.51.100.23");
    const rl = [...t.kv.store.keys()].filter((k) => k.startsWith("rl:"));
    expect(rl.length).toBe(1);
    expect(rl[0]).toMatch(/^rl:[0-9a-f]{64}$/);
    expect(rl[0]).not.toContain("198.51.100.23");
    expect(t.kv.ttl.get(rl[0])).toBe(TALK_LIMITS.windowSeconds);
  });

  test("invalid requests do not spend the rate-limit budget", async () => {
    const t = setup();
    for (let i = 0; i < 6; i++) await t.post({ ...good, consent: false });
    expect((await t.post(good)).status).toBe(201);
  });

  test("503 when the KV binding is missing", async () => {
    const res = await worker.fetch(
      new Request("https://uptick-evidence.test/talk", { method: "POST", body: JSON.stringify(good) }),
      {},
      ctx,
    );
    expect(res.status).toBe(503);
  });

  test("GET /talk is 405 and the CORS preflight allows POST from the site", async () => {
    const t = setup();
    const get = await worker.fetch(new Request("https://uptick-evidence.test/talk"), t.env, ctx);
    expect(get.status).toBe(405);
    const pre = await worker.fetch(new Request("https://uptick-evidence.test/talk", { method: "OPTIONS" }), t.env, ctx);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    expect(pre.headers.get("access-control-allow-headers")).toContain("content-type");
  });
});

describe("GET /talk/count", () => {
  test("is exactly { count } and follows the stored rows across KV pages", async () => {
    const t = setup();
    expect(await t.count()).toEqual({ count: 0 });
    for (let i = 0; i < 5; i++) expect((await t.post(good, `203.0.113.${50 + i}`)).status).toBe(201);
    expect(t.submissions().length).toBe(5);
    // FakeKV pages by 2, so 5 rows only count correctly if the cursor loop runs.
    expect(await t.count()).toEqual({ count: 5 });
  });

  test("does not count rate-limit keys or leak answers", async () => {
    const t = setup();
    await t.post(good);
    const body = JSON.stringify(await t.count());
    expect(body).toBe('{"count":1}');
    expect(body).not.toContain("NVDA");
  });
});
