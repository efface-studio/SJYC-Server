import { PhoneSignup } from './phone-signup';
import { Injectable } from '@nestjs/common';
import { type OAuthProvider, type User } from '@prisma/client';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { env } from '../config/env';
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
    private readonly phoneSignup: PhoneSignup,
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

  async complete(token: string, input: z.infer<typeof onboardingInput>, ip: string) {
    const draft = await this.read(token);
    if (!draft.userId && (!input.agreePrivacy || !input.agreeTerms))
      throw new AppException('VALIDATION', '필수 항목에 동의해 주세요.');
    const existing = await this.db.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing && existing.id !== draft.userId) throw conflict();
    const result = await this.phoneSignup.start(
      'social:' + hashToken(token),
      {
        kind: 'social',
        userId: draft.userId,
        provider: draft.provider,
        subject: draft.subject,
        originalEmail: draft.originalEmail,
        email: input.email,
        emailVerified: input.email === draft.verifiedEmail,
        name: input.name,
        birthDate: input.birthDate,
        birthYear: Number(input.birthDate.slice(0, 4)),
        marketing: input.agreeMarketing,
      },
      input.phone,
      ip,
    );
    await this.redis.del(draftKey(token));
    return result;
  }
}
