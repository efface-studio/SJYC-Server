const dateFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dateTimeFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 서울 기준 오늘 날짜 YYYY-MM-DD */
export function todayKst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
}

/** ISO → 서울 기준 YYYY-MM-DD (date input 값) */
export function toDateInput(iso: string): string {
  return todayKst(new Date(iso));
}

/** 오늘(서울)부터 해당 시각의 날짜까지 남은 일수 — 같은 날이면 0 */
export function daysUntil(iso: string, now = new Date()): number {
  const a = Date.parse(`${todayKst(now)}T00:00:00Z`);
  const b = Date.parse(`${toDateInput(iso)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** "10.22 (수)" */
export function formatShortDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}.${get('day')} (${get('weekday')})`;
}

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

export function formatPeriod(startIso: string, endIso: string): string {
  return `${formatDate(startIso)} ~ ${formatDate(endIso)}`;
}

/** 동아리원 명단 등 최소 권한 노출용 — "홍길동" → "홍*동" */
export function maskName(name: string): string {
  const chars = [...name];
  if (chars.length <= 1) return name;
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
