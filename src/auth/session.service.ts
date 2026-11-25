import { staffScope } from '../operations/developer-controls';
import { Injectable } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import type { Response } from 'express';
import { env, isProd } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken, randomToken } from './tokens';

export const SESSION_COOKIE = 'sjyc_session';

/** 세션의 회원 + 담당 동아리 ID (권한 판단에 쓴다) */
export type AuthUser = UserRow & { managedClubIds: string[]; permissionScope?: string[] };

export interface ResolvedSession {
  user: AuthUser;
  expiresAt: Date;
  renewed: boolean;
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  private ttlMs() {
    return env().SESSION_TTL_HOURS * 3_600_000;
  }

  async create(userId: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.ttlMs());
    await this.prisma.session.create({
      data: { tokenHash: hashToken(token), userId, expiresAt, userAgent: userAgent?.slice(0, 200) },
    });
    return { token, expiresAt };
  }

  /** 유효한 세션이면 회원을 돌려준다. 활동 중인 회원만, 절반 이상 지났으면 만료를 연장한다 */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const s = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { managedClubs: { select: { clubId: true } } } } },
    });
    if (!s || s.expiresAt.getTime() <= Date.now() || s.user.status !== 'active') return null;
    const { managedClubs, ...row } = s.user;
    const user: AuthUser = {
      ...row,
      permissionScope: await staffScope(this.prisma, row.id, row.roles),
      managedClubIds: managedClubs.map((m) => m.clubId),
    };
    if (s.expiresAt.getTime() - Date.now() >= this.ttlMs() / 2) {
      return { user, expiresAt: s.expiresAt, renewed: false };
    }
    const expiresAt = new Date(Date.now() + this.ttlMs());
    await this.prisma.session.update({ where: { id: s.id }, data: { expiresAt } });
    return { user, expiresAt, renewed: true };
  }

  async devices(userId: string, currentToken: string) {
    const now = new Date();
    const current = hashToken(currentToken);
    const rows = await this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tokenHash: true, userAgent: true, createdAt: true, expiresAt: true },
    });
    return rows.map(({ id, tokenHash, userAgent, createdAt, expiresAt }) => {
      const agent = userAgent ?? '';
      const label = /iPhone|iPad|CFNetwork|Darwin/i.test(agent)
        ? 'Apple 기기'
        : /Android|okhttp/i.test(agent)
          ? 'Android 기기'
          : /Macintosh/i.test(agent)
            ? 'Mac'
            : /Windows/i.test(agent)
              ? 'Windows'
              : '로그인 기기';
      return {
        id,
        label,
        current: tokenHash === current,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async revokeDevice(userId: string, id: string, currentToken: string) {
    await this.prisma.session.deleteMany({
      where: { userId, id, tokenHash: { not: hashToken(currentToken) } },
    });
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  /** 비밀번호 재설정·탈퇴·정지 시 모든 기기에서 로그아웃 */
  async revokeAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd(),
      domain: env().COOKIE_DOMAIN,
      path: '/',
      expires: expiresAt,
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/', domain: env().COOKIE_DOMAIN });
  }
}
