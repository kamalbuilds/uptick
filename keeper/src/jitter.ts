import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const ENV_LOCAL = new URL("../.env.local", import.meta.url).pathname;

/** The keeper's local jitter salt: KEEPER_JITTER_SALT from the environment, else a fresh random one written to
 *  keeper/.env.local (gitignored) on first run, so the recentre minute cannot be computed from the code and the calendar. */
export function loadJitterSalt(env: Record<string, string | undefined> = process.env, file = ENV_LOCAL): string {
  const have = env.KEEPER_JITTER_SALT?.trim();
  if (have) return have;
  const salt = randomBytes(16).toString("hex");
  const kept = (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").filter((l) => l && !l.startsWith("KEEPER_JITTER_SALT="));
  writeFileSync(file, [...kept, `KEEPER_JITTER_SALT=${salt}`].join("\n") + "\n", { mode: 0o600 });
  env.KEEPER_JITTER_SALT = salt;
  return salt;
}
