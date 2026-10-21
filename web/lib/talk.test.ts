import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TALK_LIMITS, fetchTalkCount, submitTalk, toPayload, validateTalk, type TalkForm } from "./talk.ts";

const good: TalkForm = {
  holds: "NVDA, about $3k",
  today: "It sits in my wallet",
  blocker: "I cannot watch a range",
  yield: "8% kept after losses",
  loi: "maybe",
  handle: "@someone",
  consent: true,
};

const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

test("a complete form has no errors", () => {
  assert.deepEqual(validateTalk(good), {});
});

test("each required field, the loi choice and consent produce their own error", () => {
  for (const field of ["holds", "today", "blocker", "yield"] as const) {
    assert.ok(validateTalk({ ...good, [field]: "   " })[field], field);
  }
  assert.ok(validateTalk({ ...good, loi: "" }).loi);
  assert.ok(validateTalk({ ...good, consent: false }).consent);
  assert.equal(Object.keys(validateTalk({ ...good, holds: "", loi: "", consent: false })).length, 3);
});

test("the limit passes and one character over fails, for every field", () => {
  for (const field of ["holds", "today", "blocker", "yield"] as const) {
    assert.equal(validateTalk({ ...good, [field]: "a".repeat(TALK_LIMITS[field]) })[field], undefined, `${field} at limit`);
    assert.ok(validateTalk({ ...good, [field]: "a".repeat(TALK_LIMITS[field] + 1) })[field], `${field} over limit`);
  }
  assert.equal(validateTalk({ ...good, handle: "a".repeat(TALK_LIMITS.handle) }).handle, undefined);
  assert.ok(validateTalk({ ...good, handle: "a".repeat(TALK_LIMITS.handle + 1) }).handle);
});

test("the handle is optional, and a malformed one is refused", () => {
  assert.equal(validateTalk({ ...good, handle: "" }).handle, undefined);
  assert.ok(validateTalk({ ...good, handle: "has space" }).handle);
  assert.ok(validateTalk({ ...good, handle: "a@b.com" }).handle);
});

test("the client limits are the Worker limits", () => {
  const worker = readFileSync(new URL("../../api/src/talk.ts", import.meta.url), "utf8");
  const block = worker.match(/TALK_LIMITS = \{([\s\S]*?)\} as const/);
  assert.ok(block, "TALK_LIMITS block found in api/src/talk.ts");
  for (const [name, n] of Object.entries(TALK_LIMITS)) {
    assert.match(block[1], new RegExp(`\\b${name}: ${n}\\b`), `${name} is ${n} in the Worker`);
  }
});

test("submit posts trimmed JSON to /talk on the given base and reports success on 201", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return reply(201, { ok: true });
  }) as unknown as typeof fetch;
  const out = await submitTalk({ ...good, holds: "  NVDA  " }, fake, "https://w.example");
  assert.deepEqual(out, { ok: true });
  assert.equal(seen?.url, "https://w.example/talk");
  assert.equal(seen?.init.method, "POST");
  const sent = JSON.parse(String(seen?.init.body));
  assert.deepEqual(sent, toPayload({ ...good, holds: "NVDA" }));
  assert.equal(sent.consent, true);
  assert.equal(sent.holds, "NVDA");
});

test("submit maps 429, 400 with a field, 5xx and a network failure to a message the page can show", async () => {
  const run = (f: () => Promise<Response>) => submitTalk(good, (async () => f()) as unknown as typeof fetch, "");
  const limited = await run(async () => reply(429, { error: "rate_limited" }));
  assert.equal(limited.ok, false);
  assert.match((limited as { message: string }).message, /last hour/);

  const bad = await run(async () => reply(400, { error: "invalid", field: "yield", message: "required" }));
  assert.equal((bad as { field?: string }).field, "yield");

  const unknownField = await run(async () => reply(400, { error: "invalid", field: "nope" }));
  assert.equal((unknownField as { field?: string }).field, undefined);

  const down = await run(async () => reply(503, { error: "talk_unavailable" }));
  assert.match((down as { message: string }).message, /503/);

  const offline = await run(async () => {
    throw new TypeError("fetch failed");
  });
  assert.equal(offline.ok, false);
  assert.match((offline as { message: string }).message, /did not respond/);
});

test("count returns the number, and null for a bad status, a bad body or a network failure", async () => {
  const of = (f: () => Promise<Response>) => fetchTalkCount((async () => f()) as unknown as typeof fetch, "https://w.example");
  assert.equal(await of(async () => reply(200, { count: 7 })), 7);
  assert.equal(await of(async () => reply(200, { count: 0 })), 0);
  assert.equal(await of(async () => reply(500, { count: 7 })), null);
  assert.equal(await of(async () => reply(200, { count: "7" })), null);
  assert.equal(await of(async () => reply(200, { count: -1 })), null);
  assert.equal(await of(async () => reply(200, {})), null);
  assert.equal(
    await of(async () => {
      throw new Error("down");
    }),
    null,
  );
});

test("visible copy in the interview has no em or en dash", () => {
  for (const f of ["./talk.ts", "../components/talk-form.tsx", "../app/talk/page.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.equal(/[–—]/.test(src), false, f);
  }
});
