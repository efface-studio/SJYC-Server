import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, type OAuthProvider, type SignupPhoneChallenge } from '@prisma/client';
import { randomInt, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { AppException } from '../common/app-exception';
import { RateLimitService } from '../common/rate-limit';
import { env, isProd } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { randomToken, hashToken } from './tokens';
import { logger } from '../common/logger';
import { SignupSms } from './signup-sms';

export type Enrollment = {
  name: string;
  email: string;
  birthDate: string | null;
  birthYear: number;
  marketing: boolean;
} & (
  | { kind: 'password'; passwordHash: string; userId: string | null }
  | {
      kind: 'social';
      provider: OAuthProvider;
      subject: string;
      userId: string | null;
      originalEmail: string | null;
      emailVerified: boolean;
    }
);
const invalid = () =>
  new AppException('VALIDATION', '인증 요청이 만료되었습니다. 회원가입을 다시 진행해 주세요.');
const taken = () =>
  new AppException('CONFLICT', '이미 가입된 이메일 또는 소셜 계정입니다.', {
    reason: 'EMAIL_TAKEN',
    fieldErrors: { email: '이미 사용 중인 이메일입니다.' },
  });
export const phoneCookie = 'sjyc_signup_phone';
const cookieOptions = () => ({
  httpOnly: true,
  secure: isProd() || env().API_PUBLIC_URL.startsWith('https:'),
  sameSite: 'lax' as const,
  path: new URL(env().API_PUBLIC_URL).pathname.replace(/\/$/, '') + '/auth/phone-verification',
});
export function savePhoneTicket(res: Response, ticket: string) {
  res.cookie(phoneCookie, ticket, { ...cookieOptions(), maxAge: 15 * 60000 });
}
export function clearPhoneTicket(res: Response) {
  res.clearCookie(phoneCookie, cookieOptions());
}
const formatPhone = (p: string) => p.replace(/-/g, '').replace(/^(01.)(\d{3,4})(\d{4})$/, '$1-$2-$3');
const digest = (ticket: string, phone: string, code: string) => hashToken(ticket + ':' + phone + ':' + code);
const publicState = (row: SignupPhoneChallenge) => ({
  phone: row.phone,
  verificationMode: env().SIGNUP_PREVIEW_CODE === 'on' ? ('preview' as const) : ('sms' as const),
  resendAt: new Date(+row.sentAt + 30000).toISOString(),
  expiresAt: row.codeExpiresAt.toISOString(),
});
async function lock(tx: Prisma.TransactionClient, scope: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope},0))`;
}
@Injectable()
export class PhoneSignup implements OnModuleInit, OnModuleDestroy {
  private cleanup?: ReturnType<typeof setInterval>;
  constructor(
    private readonly db: PrismaService,
    private readonly sms: SignupSms,
    private readonly limit: RateLimitService,
  ) {}
  onModuleInit() {
    this.cleanup = setInterval(() => {
      void this.db.signupPhoneChallenge
        .deleteMany({ where: { expiresAt: { lt: new Date() } } })
        .catch(() => logger.warn('만료된 가입 인증 요청 정리에 실패했습니다'));
    }, 60000);
    this.cleanup.unref();
  }
  onModuleDestroy() {
    clearInterval(this.cleanup);
  }
  async view(ticket: string) {
    return publicState(await this.read(ticket));
  }
  private async read(ticket: string) {
    if (!/^[\w-]{43}$/.test(ticket)) throw invalid();
    const row = await this.db.signupPhoneChallenge.findUnique({ where: { ticketHash: hashToken(ticket) } });
    if (!row || +row.expiresAt <= Date.now()) throw invalid();
    return row;
  }
  async resend(ticket: string, phone: string | undefined, ip: string) {
    const row = await this.read(ticket);
    return this.start(row.scope, row.data as Enrollment, phone ?? row.phone, ip, row.ticketHash);
  }
  async start(scope: string, data: Enrollment, number: string, ip: string, expectedTicket?: string) {
    const phone = formatPhone(number);
    if (await this.limit.exceeded('signup-sms:ip:' + ip, 25, 3600)) throw new AppException('RATE_LIMITED');
    const ticket = randomToken();
    const row = await this.db.$transaction(
      async (tx) => {
        await lock(tx, scope);
        const prior = await tx.signupPhoneChallenge.findUnique({ where: { scope } });
        if (
          expectedTicket &&
          (!prior || prior.ticketHash !== expectedTicket || +prior.expiresAt <= Date.now())
        )
          throw invalid();
        if (prior && prior.phone === phone && Date.now() - Number(prior.sentAt) < 30000)
          throw new AppException('RATE_LIMITED', '30초 후 다시 요청할 수 있습니다.');
        if (
          (await this.limit.exceeded('signup-sms:number:' + hashToken(phone), 5, 3600)) ||
          (await this.limit.exceeded('signup-sms:scope:' + scope, 8, 3600))
        )
          throw new AppException('RATE_LIMITED', '인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
        const code =
          env().SIGNUP_PREVIEW_CODE === 'on' ? '284600' : String(randomInt(1000000)).padStart(6, '0');
        const now = Date.now();
        const values = {
          ticketHash: hashToken(ticket),
          data,
          phone,
          codeHash: digest(ticket, phone, code),
          attempts: 0,
          sentAt: new Date(now),
          codeExpiresAt: new Date(now + 300000),
          expiresAt: new Date(now + 900000),
        };
        const result = await tx.signupPhoneChallenge.upsert({
          where: { scope },
          create: { scope, ...values },
          update: values,
        });
        await this.sms.send(phone, code);
        return result;
      },
      { timeout: 10000 },
    );
    return { ticket, state: publicState(row) };
  }
  async confirm(ticket: string, code: string) {
    const initial = await this.read(ticket);
    const result = await this.db
      .$transaction(async (tx) => {
        await lock(tx, initial.scope);
        const row = await tx.signupPhoneChallenge.findUnique({ where: { ticketHash: hashToken(ticket) } });
        if (!row || +row.expiresAt <= Date.now()) throw invalid();
        if (+row.codeExpiresAt <= Date.now())
          throw new AppException('VALIDATION', '코드의 유효 시간이 지났습니다. 새 코드를 요청해 주세요.');
        if (row.attempts >= 5)
          throw new AppException('RATE_LIMITED', '입력 횟수를 초과했습니다. 새 코드를 요청해 주세요.');
        if (!timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(digest(ticket, row.phone, code)))) {
          await tx.signupPhoneChallenge.update({
            where: { scope: row.scope },
            data: { attempts: { increment: 1 } },
          });
          return null;
        }
        const enrollment = row.data as Enrollment;
        const now = new Date(),
          at = now.toISOString();
        const info = {
          name: enrollment.name,
          email: enrollment.email,
          birthYear: enrollment.birthYear,
          birthDate: enrollment.birthDate ? new Date(enrollment.birthDate) : null,
          phone: row.phone,
          signupPhoneVerifiedAt: now,
          emailVerified: enrollment.kind === 'social' && enrollment.emailVerified,
        };
        const consents = [
          { key: 'terms', required: true, agreed: true, agreedAt: at },
          { key: 'privacy', required: true, agreed: true, agreedAt: at },
          {
            key: 'marketing',
            required: false,
            agreed: enrollment.marketing,
            agreedAt: enrollment.marketing ? at : null,
          },
        ];
        let userId = enrollment.userId;
        if (userId) {
          const guard =
            enrollment.kind === 'social'
              ? {
                  email: enrollment.originalEmail!,
                  socialIdentities: { some: { provider: enrollment.provider, subject: enrollment.subject } },
                  OR: [{ birthDate: null }, { phone: null }, { phone: '' }, { name: '' }],
                }
              : {
                  email: enrollment.email,
                  passwordHash: enrollment.passwordHash,
                  emailVerified: false,
                  signupPhoneVerifiedAt: null,
                };
          const updated = await tx.user.updateMany({
            where: { id: userId, status: 'active', ...guard },
            data: info,
          });
          if (!updated.count) throw invalid();
        } else {
          const method =
            enrollment.kind === 'password'
              ? { passwordHash: enrollment.passwordHash }
              : {
                  providers: [enrollment.provider],
                  socialIdentities: {
                    create: { provider: enrollment.provider, subject: enrollment.subject },
                  },
                };
          userId = (await tx.user.create({ data: { ...info, ...method, consents } })).id;
        }
        await tx.signupPhoneChallenge.delete({ where: { scope: row.scope } });
        return { userId, social: enrollment.kind === 'social' };
      })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw taken();
        throw e;
      });
    if (!result) throw new AppException('VALIDATION', '인증 코드가 일치하지 않습니다.');
    return result;
  }
}
