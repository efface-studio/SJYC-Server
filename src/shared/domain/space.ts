import type { TimeSlot } from './types';

/**
 * 공간 예약 시간 규칙 (가정 — 센터 운영 정책 확정 필요, docs/product-scope.md 참고)
 * - 예약 단위: 1시간, 이용일 기준 내일부터 30일 이내
 * - 예약 가능 시간: 평일 09–21시, 토요일 09–18시, 일요일·공휴일 예약 불가
 * 서버가 최종 판단하며, 이 함수는 mock 과 화면 안내가 같은 규칙을 쓰기 위한 기준이다.
 */
export const RESERVATION_HOURS: Record<number, readonly [number, number] | null> = {
  0: null,
  1: [9, 21],
  2: [9, 21],
  3: [9, 21],
  4: [9, 21],
  5: [9, 21],
  6: [9, 18],
};
export const RESERVATION_MAX_DAYS_AHEAD = 30;
export const RESERVATION_MAX_HOURS = 3;

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD 의 요일 (0=일) — 시간대와 무관하게 달력 날짜 기준 */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 내일부터 찾은 첫 예약 가능 요일 */
export function firstReservableDate(today: string): string {
  for (let i = 1; i <= 7; i += 1) {
    const d = addDays(today, i);
    if (RESERVATION_HOURS[weekdayOf(d)]) return d;
  }
  return addDays(today, 1);
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function buildSlots(date: string, taken: { startTime: string; endTime: string }[]): TimeSlot[] {
  const hours = RESERVATION_HOURS[weekdayOf(date)];
  if (!hours) return [];
  const slots: TimeSlot[] = [];
  for (let h = hours[0]; h < hours[1]; h += 1) {
    const start = `${pad(h)}:00`;
    const end = `${pad(h + 1)}:00`;
    slots.push({ start, end, available: !taken.some((t) => overlaps(start, end, t.startTime, t.endTime)) });
  }
  return slots;
}

/** 예약 요청 검증. 문제가 없으면 null, 있으면 사용자 안내 문구 */
export function reservationWindowError(
  date: string,
  start: string,
  end: string,
  today: string,
): string | null {
  if (date <= today) return '이용일은 내일 이후로 선택해 주세요.';
  if (date > addDays(today, RESERVATION_MAX_DAYS_AHEAD)) {
    return `이용일은 ${RESERVATION_MAX_DAYS_AHEAD}일 이내로 선택해 주세요.`;
  }
  const hours = RESERVATION_HOURS[weekdayOf(date)];
  if (!hours) return '일요일에는 예약할 수 없습니다.';
  if (start < `${pad(hours[0])}:00` || end > `${pad(hours[1])}:00`) {
    return `해당 요일 예약 가능 시간은 ${pad(hours[0])}:00~${pad(hours[1])}:00 입니다.`;
  }
  if (start >= end) return '종료 시간은 시작 시간 이후여야 합니다.';
  const hoursUsed = Number(end.slice(0, 2)) - Number(start.slice(0, 2));
  if (hoursUsed > RESERVATION_MAX_HOURS)
    return `한 번에 최대 ${RESERVATION_MAX_HOURS}시간까지 예약할 수 있습니다.`;
  return null;
}
