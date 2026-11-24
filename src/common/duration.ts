const UNITS = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

/** `15m`, `1h`, `30d` → milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d|w)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration "${value}"`);
  }
  return Number(match[1]) * UNITS[match[2] as keyof typeof UNITS];
}
