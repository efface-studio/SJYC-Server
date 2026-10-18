import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { buildSlots } from '../shared/domain/space';
import type { Space, TimeSlot } from '../shared/domain/types';
import { toSpace } from './space.mapper';

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
}
