export interface GuardInput {
  poolUsd: number;
  clUsd: number;
  clUpdatedAt: number; // unix s
  now: number; // unix s
  maxDevBps: number;
  clMaxAgeS: number;
}
export interface GuardResult { ok: boolean; reasons: string[]; devBps: number; clAgeS: number }

import { deviationBps } from "./price.ts";

export function evaluateGuards(g: GuardInput): GuardResult {
  const reasons: string[] = [];
  const clAgeS = g.now - g.clUpdatedAt;
  const devBps = deviationBps(g.poolUsd, g.clUsd);
  if (!(g.clUsd > 0) || !Number.isFinite(g.clUsd)) reasons.push("chainlink_answer_invalid");
  if (!(g.poolUsd > 0) || !Number.isFinite(g.poolUsd)) reasons.push("pool_price_invalid");
  if (clAgeS > g.clMaxAgeS) reasons.push(`chainlink_stale age=${clAgeS}s max=${g.clMaxAgeS}s`);
  if (!Number.isFinite(devBps) || Math.abs(devBps) > g.maxDevBps) reasons.push(`pool_chainlink_deviation ${devBps.toFixed(1)}bps max=${g.maxDevBps}bps`);
  return { ok: reasons.length === 0, reasons, devBps, clAgeS };
}
