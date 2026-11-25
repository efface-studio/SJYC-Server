import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type OAuthProvider, type User } from '@prisma/client';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { RateLimitService } from '../common/rate-limit';
import { env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { todayKst } from '../shared/lib/format';
import { profileSchema, forgotPasswordSchema } from '../shared/domain/schemas';
import { hashToken, randomToken } from './tokens';
import type { ProviderProfile } from './social-profile';

export const onboardingInput = profileSchema.pick({ name: true, phone: true }).extend({
  email: forgotPasswordSchema.shape.email.transform((email) => email.toLowerCase()),
  birthDate: z.iso.date().refine((d) => d >= '1920-01-01' && d <= todayKst(), '생년월일을 확인해 주세요.'),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  agreeTerms: z.boolean(),
  agreePrivacy: z.boolean(),
  agreeMarketing: z.boolean(),
});
interface Draft {
  provider: OAuthProvider;
  subject: string;
  userId: string | null;
  originalEmail: string | null;
  name: string;
  email: string;
  phone: string;
  birthDate: string;
  verifiedEmail: string | null;
}
const expired = () =>
  new AppException('VALIDATION', '가입 요청이 만료되었습니다. 소셜 로그인을 다시 시작해 주세요.');
const conflict = () =>
  new AppException(
    'CONFLICT',
    '이미 사용 중인 이메일 또는 소셜 계정입니다. 기존 계정으로 로그인한 뒤 설정에서 연결해 주세요.',
  );
const draftKey = (token: string) => 'social:onboarding:' + hashToken(token);

@Injectable()
export class SocialOnboarding {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly limiter: RateLimitService,
  ) {}

  async begin(provider: OAuthProvider, profile: ProviderProfile, user?: User) {
    const token = randomToken();
    const draft: Draft = {
      provider,
      subject: profile.subject,
      userId: user?.id ?? null,
      originalEmail: user?.email ?? null,
      name: user?.name || profile.name || '',
      email: user?.email || profile.email || '',
      phone: user?.phone || profile.phone || '',
      birthDate: user?.birthDate?.toISOString().slice(0, 10) || profile.birthDate || '',
      verifiedEmail: user?.emailVerified ? user.email : (profile.verifiedEmail ?? null),
    };
    await this.redis.set(draftKey(token), JSON.stringify(draft), 'EX', 900);
    return { onboarding: token } as const;
  }

  private async read(token: string) {
    if (!/^[\w-]{43}$/.test(token)) throw expired();
    const value = await this.redis.get(draftKey(token));
    if (!value) throw expired();
    return JSON.parse(value) as Draft;
  }

  async view(token: string) {
    const { name, email, phone, birthDate, verifiedEmail, userId } = await this.read(token);
    return {
      name,
      email,
      phone,
      birthDate,
      verifiedEmail,
      needsConsent: userId === null,
      previewCode: env().SIGNUP_PREVIEW_CODE === 'on',
    };
  }

  async requestCode(token: string, address: string) {
    await this.read(token);
    const key = draftKey(token);
    const email = address.trim().toLowerCase();
    if (
      (await this.limiter.exceeded(key + ':sends', 5, 900)) ||
      (await this.limiter.exceeded('social:mail:' + hashToken(email), 3, 600))
    )
      throw new AppException('RATE_LIMITED');
    const preview = env().SIGNUP_PREVIEW_CODE === 'on';
    const code = preview ? '284600' : String(randomInt(100000, 1000000));
    if (!preview)
      await this.mail.send({
        to: email,
        subject: '[중구청소년센터] 이메일 확인 코드',
        text: '소셜 가입을 계속하려면 5분 이내에 ' + code + '을 입력해 주세요.',
      });
    await this.redis.set(key + ':code', hashToken(token + ':' + email + ':' + code), 'EX', 300);
  }

  async complete(token: string, input: z.infer<typeof onboardingInput>) {
    const draft = await this.read(token);
    const key = draftKey(token);
    if (!draft.userId && (!input.agreePrivacy || !input.agreeTerms))
      throw new AppException('VALIDATION', '필수 항목에 동의해 주세요.');
    if (input.email !== draft.verifiedEmail) {
      if (await this.limiter.exceeded(key + ':tries', 10, 900)) throw new AppException('RATE_LIMITED');
      if (
        !input.code ||
        (await this.redis.get(key + ':code')) !== hashToken(token + ':' + input.email + ':' + input.code)
      )
        throw new AppException('VALIDATION', '이메일 확인 코드가 일치하지 않거나 만료되었습니다.');
    }
    const now = new Date().toISOString();
    const data = {
      name: input.name,
      email: input.email,
      phone: input.phone,
      birthDate: new Date(input.birthDate),
      birthYear: Number(input.birthDate.slice(0, 4)),
      emailVerified: true,
    };
    const { provider, subject } = draft;
    try {
      const id = await this.db.$transaction(async (tx) => {
        if (draft.userId) {
          const changed = await tx.user.updateMany({
            where: {
              id: draft.userId,
              email: draft.originalEmail!,
              status: 'active',
              socialIdentities: { some: { provider, subject } },
              OR: [{ birthDate: null }, { phone: null }, { phone: '' }, { name: '' }],
            },
            data,
          });
          if (!changed.count) throw expired();
          return draft.userId;
        }
        const user = await tx.user.create({
          data: {
            ...data,
            providers: [provider],
            socialIdentities: { create: { provider, subject } },
            consents: [
              { key: 'terms', required: true, agreed: true, agreedAt: now },
              { key: 'privacy', required: true, agreed: true, agreedAt: now },
              {
                key: 'marketing',
                required: false,
                agreed: input.agreeMarketing,
                agreedAt: input.agreeMarketing ? now : null,
              },
            ],
          },
        });
        return user.id;
      });
      await this.redis.del(key, key + ':code');
      return id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict();
      throw error;
    }
  }
}
