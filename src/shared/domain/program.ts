import type { Program, RecruitStatus } from './types';

/**
 * 모집 상태 계산 규칙. 원칙적으로 서버가 계산해 recruitStatus 로 내려주며,
 * 이 함수는 mock adapter 와 서버 구현이 같은 규칙을 쓰도록 공유하는 기준이다.
 */
export function computeRecruitStatus(
  p: Pick<Program, 'recruitStartsAt' | 'recruitEndsAt' | 'capacity' | 'appliedCount'>,
  now: Date,
): RecruitStatus {
  const t = now.getTime();
  if (t < Date.parse(p.recruitStartsAt)) return 'upcoming';
  if (t > Date.parse(p.recruitEndsAt)) return 'closed';
  if (p.appliedCount >= p.capacity) return 'full';
  return 'open';
}

export function remainingSeats(p: Pick<Program, 'capacity' | 'appliedCount'>): number {
  return Math.max(0, p.capacity - p.appliedCount);
}
