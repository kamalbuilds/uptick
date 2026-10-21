/** The /talk interview: field limits (the Worker in api/src/talk.ts enforces the same numbers), client checks, and the two calls. */

export const TALK_LIMITS = { holds: 500, today: 500, blocker: 500, yield: 300, handle: 40 } as const;
export const LOI_CHOICES = ["yes", "maybe", "no"] as const;

export type Loi = (typeof LOI_CHOICES)[number];
export type TalkForm = {
  holds: string;
  today: string;
  blocker: string;
  yield: string;
  loi: Loi | "";
  handle: string;
  consent: boolean;
};
export type TalkErrors = Partial<Record<keyof TalkForm, string>>;

const KEEPER = process.env.NEXT_PUBLIC_KEEPER_BASE || "";
/** The evidence Worker origin: set directly, or the static build's keeper base without its "/keeper" suffix. Empty in local dev, where no Worker serves /talk. */
export const TALK_BASE = process.env.NEXT_PUBLIC_TALK_BASE || (/^https?:\/\//.test(KEEPER) ? KEEPER.replace(/\/keeper\/?$/, "") : "");

const HANDLE = /^@?[A-Za-z0-9_.-]+$/;

export function validateTalk(f: TalkForm): TalkErrors {
  const errors: TalkErrors = {};
  for (const field of ["holds", "today", "blocker", "yield"] as const) {
    const v = f[field].trim();
    if (v === "") errors[field] = "Write a line, even a short one.";
    else if (v.length > TALK_LIMITS[field]) errors[field] = `Keep it to ${TALK_LIMITS[field]} characters.`;
  }
  if (f.loi === "") errors.loi = "Pick one. Maybe is a fine answer.";
  const handle = f.handle.trim();
  if (handle !== "" && (!HANDLE.test(handle) || handle.replace(/^@/, "").length > TALK_LIMITS.handle)) {
    errors.handle = "Use letters, digits and _ . - only, like @name.";
  }
  if (!f.consent) errors.consent = "Tick this to send your answers.";
  return errors;
}

/** What the Worker is sent: trimmed text, the handle as typed, consent true. */
export function toPayload(f: TalkForm) {
  return { holds: f.holds.trim(), today: f.today.trim(), blocker: f.blocker.trim(), yield: f.yield.trim(), loi: f.loi, handle: f.handle.trim(), consent: f.consent };
}

type Failure = { field?: keyof TalkForm; message: string };

export async function submitTalk(f: TalkForm, doFetch: typeof fetch = fetch, base: string = TALK_BASE): Promise<{ ok: true } | ({ ok: false } & Failure)> {
  let res: Response;
  try {
    res = await doFetch(`${base}/talk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toPayload(f)) });
  } catch {
    return { ok: false, message: "The answers endpoint did not respond. Check your connection and send again." };
  }
  if (res.status === 201) return { ok: true };
  if (res.status === 429) return { ok: false, message: "That is three sets of answers from this connection in the last hour. Try again later." };
  if (res.status === 400) {
    const body: unknown = await res.json().catch(() => null);
    const field = typeof body === "object" && body !== null && "field" in body ? String((body as { field: unknown }).field) : "";
    const known = ["holds", "today", "blocker", "yield", "loi", "handle", "consent"].includes(field);
    return { ok: false, field: known ? (field as keyof TalkForm) : undefined, message: "The server rejected that field. Check it and send again." };
  }
  return { ok: false, message: `The answers endpoint returned ${res.status}. Try again in a minute.` };
}

/** How many answer sets are stored, or null when the endpoint cannot say. The page shows nothing for null or zero. */
export async function fetchTalkCount(doFetch: typeof fetch = fetch, base: string = TALK_BASE): Promise<number | null> {
  try {
    const res = await doFetch(`${base}/talk/count`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const n = typeof body === "object" && body !== null ? (body as { count?: unknown }).count : undefined;
    return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
