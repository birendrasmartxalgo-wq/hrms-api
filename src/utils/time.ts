export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

export function istToday(): Date {
  const now = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function utcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function datePartIST(date: Date): string {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

export function startOfMonthIST(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

export function endOfMonthIST(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}
