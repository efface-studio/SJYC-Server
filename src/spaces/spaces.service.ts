import { Injectable } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import type { ReservationInput } from '../shared/domain/schemas';
import { buildSlots, reservationWindowError } from '../shared/domain/space';
import type { Space, SpaceReservation, TimeSlot } from '../shared/domain/types';
import { todayKst } from '../shared/lib/format';
import { toReservation, toSpace } from './space.mapper';

const NOT_FOUND = () => new AppException('NOT_FOUND');
/** 겹침을 판단할 때 자리를 차지하는 상태 */
export const ACTIVE_RESERVATION = ['pending', 'approved'] as const;

@Injectable()
export class SpacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Space[]> {
    const rows = await this.prisma.space.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return rows.map(toSpace);
  }

  async get(id: string): Promise<Space> {
    const s = await this.prisma.space.findUnique({ where: { id } });
    if (!s) throw NOT_FOUND();
    return toSpace(s);
  }

  async availability(id: string, date: string): Promise<TimeSlot[]> {
    await this.get(id);
    const taken = await this.prisma.spaceReservation.findMany({
      where: { spaceId: id, date, status: { in: [...ACTIVE_RESERVATION] } },
      select: { startTime: true, endTime: true },
    });
    return buildSlots(date, taken);
  }

  async reserve(user: UserRow, id: string, input: ReservationInput): Promise<SpaceReservation> {
    const windowError = reservationWindowError(input.date, input.startTime, input.endTime, todayKst());
    if (windowError)
      throw new AppException('VALIDATION', windowError, { fieldErrors: { date: windowError } });
    return this.prisma.$transaction(async (tx) => {
      // 공간 행을 잠가 같은 공간의 동시 예약이 겹침 검사를 함께 통과하지 못하게 한다
      await tx.$queryRaw`SELECT id FROM "Space" WHERE id = ${id} FOR UPDATE`;
      const s = await tx.space.findUnique({ where: { id } });
      if (!s) throw NOT_FOUND();
      if (!s.reservable) {
        throw new AppException('CONFLICT', '현재 예약을 받지 않는 공간입니다.', { reason: 'RECRUIT_CLOSED' });
      }
      if (input.headcount > s.capacity) {
        throw new AppException('VALIDATION', `이 공간의 수용 인원은 ${s.capacity}명입니다.`, {
          fieldErrors: { headcount: `수용 인원(${s.capacity}명) 이하로 입력해 주세요.` },
        });
      }
      const clash = await tx.spaceReservation.findFirst({
        where: {
          spaceId: id,
          date: input.date,
          status: { in: [...ACTIVE_RESERVATION] },
          startTime: { lt: input.endTime },
          endTime: { gt: input.startTime },
        },
      });
      if (clash) {
        throw new AppException('CONFLICT', '선택한 시간에 이미 예약이 있습니다. 다른 시간을 선택해 주세요.', {
          reason: 'DUPLICATE',
        });
      }
      const r = await tx.spaceReservation.create({
        data: {
          spaceId: id,
          userId: user.id,
          applicantName: user.name,
          phone: input.phone.replace(/-/g, ''),
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
          headcount: input.headcount,
          purpose: input.purpose,
        },
        include: { space: true },
      });
      return toReservation(r);
    });
  }

  async mine(userId: string): Promise<SpaceReservation[]> {
    const rows = await this.prisma.spaceReservation.findMany({
      where: { userId },
      include: { space: true },
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
    });
    return rows.map(toReservation);
  }

  async cancel(userId: string, id: string): Promise<SpaceReservation> {
    const r = await this.prisma.spaceReservation.findUnique({ where: { id }, include: { space: true } });
    if (!r || r.userId !== userId) throw NOT_FOUND();
    // 상태 조건을 걸어 갱신 — 그 사이 관리자가 처리했으면 0건이 된다
    const { count } = await this.prisma.spaceReservation.updateMany({
      where: { id, status: { in: [...ACTIVE_RESERVATION] }, date: { gt: todayKst() } },
      data: { status: 'cancelled' },
    });
    if (count === 0) {
      throw new AppException('CONFLICT', '이미 지난 예약이거나 처리된 예약은 취소할 수 없습니다.', {
        reason: 'INVALID_STATE',
      });
    }
    return toReservation({ ...r, status: 'cancelled' });
  }
}
