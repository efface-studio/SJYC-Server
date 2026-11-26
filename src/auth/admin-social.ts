import { Injectable } from '@nestjs/common';
import { Prisma, type OAuthProvider } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { RateLimitService } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { canEnterConsole } from '../shared/domain/permissions';
import type { LoginInput } from '../shared/domain/schemas';
import { AuthService } from './auth.service';
import { checkContact, readContact } from './login-contact';
import { defersOperatorContact, hasVerifiedContact } from './operator-login';
import { SessionService } from './session.service';
import { randomToken, hashToken } from './tokens';
import { env, isProd } from '../config/env';
import type { Response } from 'express';

interface Identity {
  provider: OAuthProvider;
  subject: string;
}
const expired = () =>
  new AppException('VALIDATION', '연동 요청이 만료되었습니다. 관리자 소셜 로그인을 다시 시작해 주세요.');
const denied = () => new AppException('FORBIDDEN', '해당 계정으로 관리자 연동을 완료할 수 없습니다.');
const cookie = 'sjyc_admin_link';
const key = (token: string) => 'social:admin-link:' + hashToken(token);
const options = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd() || env().API_PUBLIC_URL.startsWith('https://'),
  path: new URL(env().API_PUBLIC_URL).pathname.replace(/\/$/, '') + '/auth/admin-social/link',
});
const include = { managedClubs: { select: { clubId: true } } } as const;

@Injectable()
export class AdminSocial {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimitService,
  ) {}

  async finish(identity: Identity, agent: string | undefined, res: Response) {
    const linked = await this.db.socialIdentity.findUnique({
      where: { provider_subject: identity },
      include: { user: { include } },
    });
    const { rule } = await readContact(this.db, 'admin');
    if (
      linked &&
      (rule || hasVerifiedContact(linked.user) || defersOperatorContact(linked.user)) &&
      canEnterConsole({ ...linked.user, managedClubIds: linked.user.managedClubs.map((m) => m.clubId) })
    ) {
      checkContact(rule, linked.user);
      await this.signIn(linked.userId, agent, res, true);
      return { signedIn: true, needsLink: false };
    }
    const token = randomToken();
    await this.redis.set(key(token), JSON.stringify(identity), 'EX', 300);
    res.cookie(cookie, token, { ...options(), maxAge: 300000 });
    return { signedIn: false, needsLink: true };
  }

  private async read(cookies: Record<string, unknown>) {
    const token = cookies?.[cookie];
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw expired();
    const raw = await this.redis.get(key(token));
    if (!raw) throw expired();
    return { token, identity: JSON.parse(raw) as Identity };
  }

  async view(cookies: Record<string, unknown>) {
    const { identity } = await this.read(cookies);
    return { provider: identity.provider };
  }

  async link(
    cookies: Record<string, unknown>,
    input: LoginInput,
    ip: string,
    agent: string | undefined,
    res: Response,
  ) {
    const { token, identity } = await this.read(cookies);
    if (
      (await this.limiter.exceeded(key(token) + ':attempts', 6, 300)) ||
      (await this.limiter.exceeded('admin-link:' + ip, 25, 600))
    )
      throw new AppException('RATE_LIMITED');
    const owner = await this.auth.verifyLogin(input, ip, 'admin');
    const operatorLogin = await this.db
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${owner.id} FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({ where: { id: owner.id }, include });
        const { rule } = await readContact(tx, 'admin');
        checkContact(rule, user);
        if (
          user.passwordHash !== owner.passwordHash ||
          user.email !== owner.email ||
          (!rule && !hasVerifiedContact(user) && !defersOperatorContact(user)) ||
          !canEnterConsole({ ...user, managedClubIds: user.managedClubs.map((m) => m.clubId) })
        )
          throw denied();
        const exists = await tx.socialIdentity.findFirst({
          where: { OR: [identity, { userId: user.id, provider: identity.provider }] },
        });
        if (exists && (exists.subject !== identity.subject || exists.userId !== user.id)) throw denied();
        if (!(await this.redis.getdel(key(token)))) throw expired();
        if (!exists) await tx.socialIdentity.create({ data: { ...identity, userId: user.id } });
        if (!user.providers.includes(identity.provider))
          await tx.user.update({ where: { id: user.id }, data: { providers: { push: identity.provider } } });
        await tx.auditEvent.create({
          data: {
            action: 'admin.social.link',
            actorId: user.id,
            actorName: user.name,
            targetType: 'user',
            targetId: user.id,
            summary: '관리자 소셜 계정 연결 · ' + identity.provider,
          },
        });
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw denied();
        throw error;
      });
    res.clearCookie(cookie, options());
    await this.signIn(owner.id, agent, res, operatorLogin);
    return { signedIn: true };
  }

  private async signIn(id: string, agent: string | undefined, res: Response, operatorLogin: boolean) {
    const session = await this.sessions.create(id, agent, operatorLogin);
    this.sessions.setCookie(res, session.token, session.expiresAt);
  }
}
