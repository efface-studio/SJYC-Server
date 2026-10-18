import type { Space as SpaceRow, SpaceReservation as ReservationRow } from '@prisma/client';
import { todayKst } from '../shared/lib/format';
import type { Space, SpaceReservation } from '../shared/domain/types';

export const toSpace = (s: SpaceRow): Space => ({
  id: s.id,
  name: s.name,
  floor: s.floor,
  capacity: s.capacity,
  description: s.description,
  reservable: s.reservable,
});

/** 대기·확정 상태이고 이용일이 오늘 이후일 때만 취소 가능 */
export function toReservation(r: ReservationRow & { space: Pick<SpaceRow, 'name'> }): SpaceReservation {
  const open = r.status === 'pending' || r.status === 'approved';
  return {
    id: r.id,
    spaceId: r.spaceId,
    spaceName: r.space.name,
    userId: r.userId,
    applicantName: r.applicantName,
    phone: r.phone,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    headcount: r.headcount,
    purpose: r.purpose,
    status: r.status,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    cancellable: open && r.date > todayKst(),
  };
}
