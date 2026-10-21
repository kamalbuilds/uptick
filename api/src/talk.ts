/**
 * POST /talk stores one async interview answer set in the TALK KV namespace.
 * GET /talk/count returns only the number of stored answer sets.
 * The only personal data is the optional handle the respondent chooses to type.
 */

export interface TalkEnv {
  TALK?: KVNamespace;
  /** Optional secret mixed into the per-IP rate-limit key. */
  TALK_SALT?: string;
}

export const TALK_LIMITS = {
  holds: 500,
  today: 500,
  blocker: 500,
  yield: 300,
  handle: 40,
  body: 4096,
  /** Accepted submissions per IP hash per window. */
  perWindow: 3,
  windowSeconds: 3600,
} as const;

export const LOI_CHOICES = ["yes", "maybe", "no"] as const;
const HANDLE = /^@?[A-Za-z0-9_.-]+$/;
const PREFIX = "s:";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
};

function reply(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

async function ipKey(request: Request, env: TalkEnv): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const bytes = new TextEncoder().encode(`${env.TALK_SALT ?? ""}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `rl:${hex}`;
}

type Parsed = { ok: true; value: Record<string, string | null> } | { ok: false; field: string; message: string };

function parse(raw: unknown): Parsed {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, field: "body", message: "expected a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  const out: Record<string, string | null> = {};

  for (const field of ["holds", "today", "blocker", "yield"] as const) {
    const v = body[field];
    if (typeof v !== "string" || v.trim() === "") return { ok: false, field, message: "required" };
    const text = v.trim();
    if (text.length > TALK_LIMITS[field]) {
      return { ok: false, field, message: `at most ${TALK_LIMITS[field]} characters` };
    }
    out[field] = text;
  }

  const loi = body.loi;
  if (typeof loi !== "string" || !(LOI_CHOICES as readonly string[]).includes(loi)) {
    return { ok: false, field: "loi", message: `one of ${LOI_CHOICES.join(", ")}` };
  }
  out.loi = loi;

  const handle = body.handle;
  if (handle === undefined || handle === null || handle === "") {
    out.handle = null;
  } else {
    const name = typeof handle === "string" ? handle.trim().replace(/^@/, "") : "";
    if (typeof handle !== "string" || !HANDLE.test(handle.trim()) || name.length > TALK_LIMITS.handle) {
      return { ok: false, field: "handle", message: `letters, digits, _ . - only, up to ${TALK_LIMITS.handle} characters` };
    }
    out.handle = name;
  }

  if (body.consent !== true) return { ok: false, field: "consent", message: "must be true" };
  return { ok: true, value: out };
}

export async function postTalk(request: Request, env: TalkEnv): Promise<Response> {
  const kv = env.TALK;
  if (!kv) return reply({ error: "talk_unavailable" }, 503);

  const text = await request.text();
  if (text.length > TALK_LIMITS.body) return reply({ error: "too_large", max: TALK_LIMITS.body }, 413);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reply({ error: "invalid", field: "body", message: "not valid JSON" }, 400);
  }
  const parsed = parse(raw);
  if (!parsed.ok) return reply({ error: "invalid", field: parsed.field, message: parsed.message }, 400);

  // ponytail: KV get-then-put is not atomic, so a burst of parallel requests can pass the limit by a few; a Durable Object counter closes it.
  const key = await ipKey(request, env);
  const used = Number((await kv.get(key)) ?? "0");
  if (used >= TALK_LIMITS.perWindow) {
    return reply({ error: "rate_limited" }, 429, { "retry-after": String(TALK_LIMITS.windowSeconds) });
  }

  const at = new Date().toISOString();
  const id = `${at}:${crypto.randomUUID()}`;
  await kv.put(`${PREFIX}${id}`, JSON.stringify({ at, ...parsed.value }));
  await kv.put(key, String(used + 1), { expirationTtl: TALK_LIMITS.windowSeconds });
  return reply({ ok: true }, 201);
}

export async function talkCount(env: TalkEnv): Promise<Response> {
  const kv = env.TALK;
  if (!kv) return reply({ error: "talk_unavailable" }, 503);
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({ prefix: PREFIX, cursor });
    count += page.keys.length;
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return reply({ count }, 200, { "cache-control": "no-store" });
}
