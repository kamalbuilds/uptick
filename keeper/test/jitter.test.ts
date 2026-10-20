import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_LOCAL, loadJitterSalt } from "../src/jitter.ts";

describe("jitter salt", () => {
  let dir = "";
  let file = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "jitter-")); file = join(dir, ".env.local"); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("first run generates a random salt, writes it to the env file with mode 0600 and the environment", () => {
    const env: Record<string, string | undefined> = {};
    const salt = loadJitterSalt(env, file);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(env.KEEPER_JITTER_SALT).toBe(salt);
    expect(readFileSync(file, "utf8")).toBe(`KEEPER_JITTER_SALT=${salt}\n`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  test("a salt already in the environment is used and nothing is written", () => {
    expect(loadJitterSalt({ KEEPER_JITTER_SALT: "from-env" }, file)).toBe("from-env");
    expect(existsSync(file)).toBe(false);
  });
  test("two fresh keepers draw different salts", () => {
    expect(loadJitterSalt({}, join(dir, "a"))).not.toBe(loadJitterSalt({}, join(dir, "b")));
  });
  test("other lines are kept and an empty KEEPER_JITTER_SALT= line is replaced, not duplicated", () => {
    writeFileSync(file, "VAULT_ADDRESS_NVDA=0xabc\nKEEPER_JITTER_SALT=\nRPC_URL=x");
    const salt = loadJitterSalt({}, file);
    expect(readFileSync(file, "utf8")).toBe(`VAULT_ADDRESS_NVDA=0xabc\nRPC_URL=x\nKEEPER_JITTER_SALT=${salt}\n`);
  });
  test("the file it writes by default is gitignored", () => {
    const rel = ENV_LOCAL.slice(ENV_LOCAL.indexOf("keeper/"));
    expect(rel).toBe("keeper/.env.local");
    const out = Bun.spawnSync(["git", "check-ignore", "-q", ENV_LOCAL], { cwd: join(import.meta.dir, "..") });
    expect(out.exitCode).toBe(0);
  });
});
