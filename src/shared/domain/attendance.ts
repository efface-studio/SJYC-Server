import type { AttendanceMemberStat, AttendanceSession, AttendanceStatus } from './types';

/**
 * 출석 집계 규칙 — 서버와 같은 규칙을 화면·mock 에서 재사용한다.
 * 출석률 = (출석 + 지각) / (출석 + 지각 + 결석). 공결은 분모에서 빼고, 체크하지 않은 회차는 세지 않는다.
 */
export function attendanceRate(c: Record<'present' | 'late' | 'absent' | 'excused', number>): number | null {
  const counted = c.present + c.late + c.absent;
  return counted === 0 ? null : Math.round(((c.present + c.late) / counted) * 100);
}

export function sessionCounts(session: AttendanceSession): Record<AttendanceStatus | 'unchecked', number> {
  const counts = { present: 0, late: 0, absent: 0, excused: 0, unchecked: 0 };
  for (const r of session.records) counts[r.status ?? 'unchecked'] += 1;
  return counts;
}

/** 여러 회차를 회원별로 누적 — 이름순 */
export function memberStats(sessions: AttendanceSession[]): AttendanceMemberStat[] {
  const byUser = new Map<string, AttendanceMemberStat>();
  for (const s of sessions) {
    for (const r of s.records) {
      const stat = byUser.get(r.userId) ?? {
        userId: r.userId,
        name: r.name,
        present: 0,
        late: 0,
        absent: 0,
        excused: 0,
        rate: null,
      };
      if (r.status) stat[r.status] += 1;
      byUser.set(r.userId, stat);
    }
  }
  return [...byUser.values()]
    .map((s) => ({ ...s, rate: attendanceRate(s) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 출석 대상 식별 문자열 'club:cl-1' — 선택 상자 값·쿼리 키에 쓴다 */
export const attendanceTargetKey = (t: { type: string; id: string }) => `${t.type}:${t.id}`;
