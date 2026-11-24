import { Injectable } from '@nestjs/common';
import { OAuthProvider, Prisma } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as providers from './social-provider';
import { hashToken, randomToken } from './tokens';

interface Attempt {
  provider: OAuthProvider;
  userId: string | null;
  verifier: string;
  claimHash: string;
}
interface Proof {
  provider: OAuthProvider;
  userId: string | null;
  subject: string;
}
const expired = () => new AppException('VALIDATION', '인증 요청이 만료됐습니다. 다시 시도해 주세요.');

@Injectable()
export class SocialService {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async status(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        passwordHash: true,
        socialIdentities: { select: { provider: true } },
      },
    });
    const linked = user.socialIdentities.map((row) => row.provider);
    return {
      linked,
      hasPassword: !!user.passwordHash,
      available: Object.values(OAuthProvider).filter(providers.configured),
    };
  }

  async start(provider: OAuthProvider, userId: string | null) {
    const state = randomToken(),
      claim = randomToken(),
      verifier = randomToken();
    const url = providers.authorize(provider, state, verifier);
    const attempt: Attempt = { provider, userId, verifier, claimHash: hashToken(claim) };
    await this.redis.set('social:state:' + hashToken(state), JSON.stringify(attempt), 'EX', 600);
    return { url, claim };
  }

  async callback(provider: OAuthProvider, state: string, code: string) {
    const saved = await this.redis.getdel('social:state:' + hashToken(state));
    if (!saved) throw expired();
    const attempt = JSON.parse(saved) as Attempt;
    if (attempt.provider !== provider) throw expired();
    const subject = await providers.providerSubject(provider, code, state, attempt.verifier);
    const receipt = randomToken();
    const proof: Proof = { provider, userId: attempt.userId, subject };
    await this.redis.set(
      'social:proof:' + hashToken(receipt) + ':' + attempt.claimHash,
      JSON.stringify(proof),
      'EX',
      180,
    );
    return receipt;
  }

  async finish(receipt: string, claim: string, userId: string | null) {
    const raw = await this.redis.getdel('social:proof:' + hashToken(receipt) + ':' + hashToken(claim));
    if (!raw) throw expired();
    const proof = JSON.parse(raw) as Proof;
    if (proof.userId !== userId) throw expired();
    const { provider, subject } = proof;
    if (!userId) {
      const identity = await this.db.socialIdentity.findUnique({
        where: { provider_subject: { provider, subject } },
        include: { user: true },
      });
      if (identity?.user.status !== 'active')
        throw new AppException(
          'VALIDATION',
          '연결된 계정이 없습니다. 기존 로그인 방법으로 로그인한 뒤 계정을 연결해 주세요.',
        );
      return identity.user.id;
    }
    try {
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.status !== 'active') throw new AppException('FORBIDDEN');
        const exists = await tx.socialIdentity.findUnique({
          where: { userId_provider: { userId, provider } },
        });
        if (exists && exists.subject !== subject)
          throw new AppException('CONFLICT', '이미 다른 계정이 연결되어 있습니다.');
        if (!exists) await tx.socialIdentity.create({ data: { userId, provider, subject } });
        if (!user.providers.includes(provider))
          await tx.user.update({ where: { id: userId }, data: { providers: { push: provider } } });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new AppException('CONFLICT', '이 소셜 계정은 이미 연결되어 있습니다.');
      throw err;
    }
    return userId;
  }

  async unlink(userId: string, provider: OAuthProvider) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { socialIdentities: true },
      });
      if (!user.socialIdentities.some((i) => i.provider === provider)) return;
      if (!user.passwordHash && user.socialIdentities.length <= 1)
        throw new AppException('CONFLICT', '마지막 로그인 수단입니다. 먼저 비밀번호를 설정해 주세요.');
      await tx.socialIdentity.delete({ where: { userId_provider: { userId, provider } } });
      await tx.user.update({
        where: { id: userId },
        data: { providers: user.providers.filter((p) => p !== provider) },
      });
    });
    return this.status(userId);
  }
}
