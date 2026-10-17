export function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
