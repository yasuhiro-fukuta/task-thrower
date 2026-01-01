// src/lib/dateOnly.ts

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function isISODate(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m1) throw new Error(`Invalid ISO date: ${iso}`);
  return { y: Number(m1[1]), m: Number(m1[2]), d: Number(m1[3]) };
}

export function toISO(v: { y: number; m: number; d: number }): string {
  return `${v.y}-${pad2(v.m)}-${pad2(v.d)}`;
}

// 左上日付 + X日（Xは固定日数）
// timezone事故回避のため UTC で計算
export function addDaysISO(baseISO: string, days: number): string {
  if (!isISODate(baseISO)) throw new Error(`Invalid baseISO: ${baseISO}`);
  const { y, m, d } = parseISO(baseISO);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISO({
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  });
}

// (26/01/02) みたいな表示用
export function formatYYMMDD(iso: string): string {
  if (!isISODate(iso)) return iso;
  const { y, m, d } = parseISO(iso);
  const yy = String(y % 100).padStart(2, "0");
  return `${yy}/${pad2(m)}/${pad2(d)}`;
}
