import type { ApplicationEditInput } from '../shared/domain/types';
import { Injectable } from '@nestjs/common';
import { Prisma, type User as UserRow } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import type { ClubApplyInput } from '../shared/domain/schemas';
import type { Club, ClubApplication, ClubMember, ClubPost, MyClub } from '../shared/domain/types';
import { maskName } from '../shared/lib/format';
import { toClub, toClubApplication, toClubPost, withMemberCount } from './club.mapper';

const NOT_FOUND = () => new AppException('NOT_FOUND');

@Injectable()
export class ClubsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Club[]> {
    const rows = await this.prisma.club.findMany({
      where: { status: 'active' },
      include: withMemberCount,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toClub);
  }

  async get(id: string): Promise<Club> {
    const c = await this.prisma.club.findUnique({ where: { id }, include: withMemberCount });
    if (!c || c.status !== 'active') throw NOT_FOUND();
    return toClub(c);
  }

  /** 명단·소식은 그 동아리 회원만 본다 */
  private async requireMember(clubId: string, userId: string, message: string) {
    const m = await this.prisma.clubMembership.findUnique({ where: { clubId_userId: { clubId, userId } } });
    if (!m) throw new AppException('FORBIDDEN', message);
  }

  async members(clubId: string, userId: string): Promise<ClubMember[]> {
    await this.requireMember(clubId, userId, '동아리원만 명단을 볼 수 있습니다.');
    const rows = await this.prisma.clubMembership.findMany({
      where: { clubId },
      include: { user: { select: { name: true } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    return rows.map((m) => ({
      displayName: maskName(m.user.name),
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  async posts(clubId: string, userId: string): Promise<ClubPost[]> {
    await this.requireMember(clubId, userId, '동아리원만 볼 수 있습니다.');
    const rows = await this.prisma.clubPost.findMany({ where: { clubId }, orderBy: { at: 'desc' } });
    return rows.map(toClubPost);
  }

  async apply(user: UserRow, clubId: string, input: ClubApplyInput): Promise<ClubApplication> {
    const c = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!c) throw NOT_FOUND();
    if (!c.recruiting || c.status !== 'active') {
      throw new AppException('CONFLICT', '현재 가입 신청을 받지 않는 동아리입니다.', {
        reason: 'RECRUIT_CLOSED',
      });
    }
    const member = await this.prisma.clubMembership.findUnique({
      where: { clubId_userId: { clubId, userId: user.id } },
    });
    if (member) throw new AppException('CONFLICT', '이미 가입한 동아리입니다.', { reason: 'DUPLICATE' });
    try {
      const a = await this.prisma.clubApplication.create({
        data: { clubId, userId: user.id, applicantName: user.name, motivation: input.motivation },
        include: { club: true },
      });
      return toClubApplication(a);
    } catch (e) {
      // 검토 중 신청 1건 부분 고유 인덱스 — 동시에 두 번 누른 경우
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppException('CONFLICT', '검토 중인 가입 신청이 있습니다.', { reason: 'DUPLICATE' });
      }
      throw e;
    }
  }

  async editApplication(userId: string, id: string, input: ApplicationEditInput) {
    return this.prisma.$transaction(async (tx) => {
      // 같은 신청의 수정 순서를 직렬화한다. 소유자가 아닌 경우 행을 잠그지 않는다.
      await tx.$queryRaw`SELECT id FROM "ClubApplication" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
      const row = await tx.clubApplication.findFirst({ where: { id, userId }, include: { club: true } });
      if (!row) throw NOT_FOUND();
      const current = toClubApplication(row);
      if (current.motivation === input.value) return current;
      const edits = current.contentEdits ?? [];
      if (edits.length !== input.revision) {
        throw new AppException('CONFLICT', '신청 내용이 변경되었습니다. 다시 확인해 주세요.');
      }
      const updated = await tx.clubApplication.update({
        where: { id },
        data: {
          motivation: input.value,
          contentEdits: [
            ...edits,
            { previous: current.motivation, next: input.value, at: new Date().toISOString() },
          ],
        },
        include: { club: true },
      });
      return toClubApplication(updated);
    });
  }

  async mine(userId: string): Promise<MyClub[]> {
    const rows = await this.prisma.clubMembership.findMany({
      where: { userId },
      include: { club: { include: withMemberCount } },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((m) => ({ club: toClub(m.club), role: m.role }));
  }

  async myApplications(userId: string): Promise<ClubApplication[]> {
    const rows = await this.prisma.clubApplication.findMany({
      where: { userId },
      include: { club: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toClubApplication);
  }
}
