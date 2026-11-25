import { defersOperatorContact } from './operator-login';
import { Injectable } from '@nestjs/common';
import { OAuthProvider, Prisma } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as providers from './social-provider';
import { hashToken, randomToken } from './tokens';

import { SocialOnboarding } from './social-onboarding';
import type { ProviderProfile } from './social-profile';

interface Attempt {
  admin?: boolean;
  provider: OAuthProvider;
  userId: string | null;
  verifier: string;
  claimHash: string;
}
interface Proof {
  admin?: boolean;
  provider: OAuthProvider;
  userId: string | null;
  profile: ProviderProfile;
}
const expired = () => new AppException('VALIDATION', '인증 요청이 만료됐습니다. 다시 시도해 주세요.');

@Injectable()
export class SocialService {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly onboarding: SocialOnboarding,
  ) {}

  async status(userId: string, nativeIOS = false) {
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
      available: providers.availableProviders(nativeIOS),
    };
  }

  async start(provider: OAuthProvider, userId: string | null, web = false, admin = false, adminLink = false) {
    const state =
        (admin ? (web ? 'adminweb.' : 'adminapp.') : web ? 'web.' : adminLink ? 'adminlink.' : '') +
        randomToken(),
      claim = randomToken(),
      verifier = randomToken();
    const url = providers.authorize(provider, state, verifier);
    const attempt: Attempt = { admin, provider, userId, verifier, claimHash: hashToken(claim) };
    await this.redis.set('social:state:' + hashToken(state), JSON.stringify(attempt), 'EX', 600);
    return { url, claim };
  }

  async callback(provider: OAuthProvider, state: string, code: string, name?: string) {
    const saved = await this.redis.getdel('social:state:' + hashToken(state));
    if (!saved) throw expired();
    const attempt = JSON.parse(saved) as Attempt;
    if (attempt.provider !== provider) throw expired();
    const profile = await providers.providerProfile(provider, code, state, attempt.verifier, name);
    const receipt = randomToken();
    const proof: Proof = { admin: attempt.admin, provider, userId: attempt.userId, profile };
    await this.redis.set(
      'social:proof:' + hashToken(receipt) + ':' + attempt.claimHash,
      JSON.stringify(proof),
      'EX',
      180,
    );
    return receipt;
  }

  async relayApple(data: { state: string; code?: string; error?: string; name?: string }) {
    if (!(await this.redis.exists('social:state:' + hashToken(data.state)))) throw expired();
    const key = randomToken();
    await this.redis.set('apple:relay:' + hashToken(key), JSON.stringify(data), 'EX', 120);
    return key;
  }

  async readAppleRelay(key: string): Promise<Record<string, unknown>> {
    const raw = await this.redis.getdel('apple:relay:' + hashToken(key));
    if (!raw) throw expired();
    return JSON.parse(raw);
  }

  async startNativeApple(userId: string | null) {
    if (!providers.nativeAppleEnabled()) throw new AppException('NOT_CONFIGURED');
    const state = randomToken(),
      nonce = randomToken();
    await this.redis.set('apple:native:' + hashToken(state), JSON.stringify({ userId, nonce }), 'EX', 600);
    return { state, nonce };
  }

  async finishNativeApple(state: string, identityToken: string, userId: string | null, name?: string) {
    const raw = await this.redis.getdel('apple:native:' + hashToken(state));
    if (!raw) throw expired();
    const challenge = JSON.parse(raw) as { userId: string | null; nonce: string };
    if (challenge.userId !== userId) throw expired();
    const profile = await providers.nativeAppleProfile(identityToken, challenge.nonce, name);
    return this.resolveIdentity({ provider: 'apple', userId, profile }, userId);
  }

  private async takeProof(receipt: string, claim: string, admin: boolean) {
    const raw = await this.redis.getdel('social:proof:' + hashToken(receipt) + ':' + hashToken(claim));
    if (!raw) throw expired();
    const proof = JSON.parse(raw) as Proof;
    if (!!proof.admin !== admin) throw expired();
    return proof;
  }

  async adminProof(receipt: string, claim: string) {
    const proof = await this.takeProof(receipt, claim, true);
    return { provider: proof.provider, subject: proof.profile.subject };
  }

  async finish(receipt: string, claim: string, userId: string | null) {
    const proof = await this.takeProof(receipt, claim, false);
    return this.resolveIdentity(proof, userId);
  }

  private async resolveIdentity(proof: Proof, userId: string | null) {
    if (proof.userId !== userId) throw expired();
    const { provider, profile } = proof;
    const { subject } = profile;
    if (!userId) {
      const identity = await this.db.socialIdentity.findUnique({
        where: { provider_subject: { provider, subject } },
        include: { user: true },
      });
      if (!identity) return this.onboarding.begin(provider, profile);
      if (identity.user.status !== 'active') throw new AppException('FORBIDDEN');
      if (!identity.user.name || !identity.user.phone || !identity.user.birthDate)
        return this.onboarding.begin(provider, profile, identity.user);
      return { userId: identity.user.id, operatorLogin: defersOperatorContact(identity.user) };
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
    return { userId };
  }

  async unlink(userId: string, provider: OAuthProvider) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { socialIdentities: true },
      });
      if (!user.socialIdentities.some((i) => i.provider === provider)) return;
      if (
        !user.passwordHash &&
        !user.socialIdentities.some(
          (identity) =>
            identity.provider !== provider &&
            identity.provider !== 'google' &&
            (identity.provider !== 'apple' ||
              providers.nativeAppleEnabled() ||
              providers.configured('apple')),
        )
      )
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
