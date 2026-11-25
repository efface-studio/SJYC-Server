import { Injectable } from '@nestjs/common';
import { type AuthTokenPurpose } from '@prisma/client';
import argon2 from 'argon2';
import { AppException } from '../common/app-exception';
import { logger } from '../common/logger';
import { RateLimitService } from '../common/rate-limit';
import { env } from '../config/env';
import { MailService, requireMailDelivery } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginInput, SignupInput } from '../shared/domain/schemas';
import { PhoneSignup } from './phone-signup';
import { SessionService } from './session.service';
import { hashToken, randomToken } from './tokens';

const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 30 * 60_000;
const BAD_LOGIN = '이메일 또는 비밀번호가 올바르지 않습니다.';

/** 존재하지 않는 계정도 같은 시간이 걸리도록 비교에 쓰는 해시 */
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= argon2.hash('timing-equalizer-not-a-password'));

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly limiter: RateLimitService,
    private readonly phoneSignup: PhoneSignup,
  ) {}

  async signup(input: SignupInput, ip: string) {
    if (await this.limiter.exceeded('signup:ip:' + ip, 10, 3600)) throw new AppException('RATE_LIMITED');
    const email = input.email.toLowerCase();
    if (await this.limiter.exceeded('signup:email:' + hashToken(email), 8, 900))
      throw new AppException('RATE_LIMITED');
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (
      existing &&
      (existing.status !== 'active' ||
        existing.emailVerified ||
        existing.signupPhoneVerifiedAt ||
        !existing.passwordHash ||
        !(await argon2.verify(existing.passwordHash, input.password)))
    )
      throw new AppException('CONFLICT', '이미 가입된 이메일입니다.', {
        reason: 'EMAIL_TAKEN',
        fieldErrors: { email: '이미 가입된 이메일입니다.' },
      });
    return this.phoneSignup.start(
      'password:' + randomToken(),
      {
        kind: 'password',
        userId: existing?.id ?? null,
        passwordHash: existing?.passwordHash ?? (await argon2.hash(input.password)),
        email,
        name: input.name,
        birthDate: input.birthDate ?? null,
        birthYear: input.birthYear,
        marketing: input.agreeMarketing,
      },
      input.phone,
      ip,
    );
  }
  /** 가입 여부와 관계없이 같은 응답 — 미인증 계정에만 실제로 보낸다 */
  async resendVerification(rawEmail: string): Promise<void> {
    const email = rawEmail.toLowerCase();
    requireMailDelivery();
    await this.checkVerificationLimit(email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified && user.status === 'active') await this.sendVerification(user.id, email);
  }

  /** 메일 링크 확인 — 성공 여부만 돌려준다 */
  async confirmEmail(token: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return false;
    const t = await this.consumeToken(token, 'verify_email');
    if (!t) return false;
    await this.prisma.user.update({ where: { id: t.userId }, data: { emailVerified: true } });
    return true;
  }

  async verifyLogin(input: LoginInput, ip: string) {
    const email = input.email.toLowerCase();
    const key = `login:${ip}:${email}`;
    if (await this.limiter.exceeded(key, 10, 900)) {
      throw new AppException('RATE_LIMITED', '로그인 시도가 많습니다. 15분 뒤 다시 시도해 주세요.');
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await argon2.verify(user?.passwordHash ?? (await dummy()), input.password);
    if (!user || !user.passwordHash || !ok || user.status === 'withdrawn') {
      throw new AppException('VALIDATION', BAD_LOGIN);
    }
    if (user.status === 'suspended') {
      throw new AppException('FORBIDDEN', '이용이 제한된 계정입니다. 센터에 문의해 주세요.');
    }
    if (!user.emailVerified && !user.signupPhoneVerifiedAt) {
      throw new AppException('FORBIDDEN', '이메일 인증을 완료한 뒤 로그인할 수 있습니다.');
    }
    await this.limiter.reset(key);
    return user;
  }

  async login(input: LoginInput, ip: string, userAgent?: string) {
    const user = await this.verifyLogin(input, ip);
    const session = await this.sessions.create(user.id, userAgent);
    const managed = await this.prisma.clubManager.findMany({
      where: { userId: user.id },
      select: { clubId: true },
    });
    return { user: { ...user, managedClubIds: managed.map((m) => m.clubId) }, ...session };
  }

  /** 가입 여부를 드러내지 않도록 항상 같은 응답 */
  async requestPasswordReset(rawEmail: string): Promise<void> {
    requireMailDelivery();
    const email = rawEmail.toLowerCase();
    if (await this.limiter.exceeded(`reset:${email}`, 3, 600)) throw new AppException('RATE_LIMITED');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.emailVerified || user.status !== 'active') return;
    const token = await this.issueToken(user.id, 'reset_password', RESET_TTL_MS);
    await this.mail.send({
      to: email,
      subject: '[중구청소년센터] 비밀번호 재설정 안내',
      text: [
        `${user.name}님, 비밀번호 재설정을 요청하셨습니다.`,
        '아래 링크에서 30분 안에 새 비밀번호를 설정해 주세요.',
        `${env().WEB_PUBLIC_URL}/password/reset?token=${token}`,
        '',
        '요청하지 않았다면 이 메일을 무시해 주세요. 비밀번호는 바뀌지 않습니다.',
      ].join('\n'),
    });
  }

  /** 새 비밀번호 저장 후 모든 기기에서 로그아웃시킨다 */
  async resetPassword(token: string, password: string): Promise<void> {
    const t = await this.consumeToken(token, 'reset_password');
    if (!t) {
      throw new AppException(
        'VALIDATION',
        '재설정 링크가 만료되었거나 올바르지 않습니다. 다시 요청해 주세요.',
      );
    }
    await this.prisma.user.update({
      where: { id: t.userId },
      data: { passwordHash: await argon2.hash(password) },
    });
    await this.sessions.revokeAll(t.userId);
  }

  private async checkVerificationLimit(email: string) {
    if (await this.limiter.exceeded(`verify:${email}`, 3, 600)) throw new AppException('RATE_LIMITED');
  }

  private async sendVerification(userId: string, email: string) {
    // 재발송 실패 시 이미 받은 인증 링크는 계속 사용할 수 있어야 한다.
    const pending = await this.prisma.authToken.findMany({
      where: { userId, purpose: 'verify_email', usedAt: null },
      select: { id: true },
    });
    const token = randomToken();
    const issued = await this.prisma.authToken.create({
      data: {
        tokenHash: hashToken(token),
        purpose: 'verify_email',
        userId,
        expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
      },
    });
    try {
      await this.mail.send({
        to: email,
        subject: '[중구청소년센터] 이메일 인증을 완료해 주세요',
        text: [
          '중구청소년센터 회원가입을 환영합니다.',
          '아래 링크를 눌러 24시간 안에 이메일 인증을 완료해 주세요.',
          `${env().API_PUBLIC_URL}/auth/email-verification/confirm?token=${token}`,
        ].join('\n'),
      });
    } catch {
      logger.error('가입 인증 메일 전송 실패');
      await this.prisma.authToken.deleteMany({ where: { id: issued.id } });
      throw new AppException('NETWORK', '인증 메일을 보내지 못했습니다. 잠시 후 다시 요청해 주세요.');
    }
    await this.prisma.authToken.deleteMany({ where: { id: { in: pending.map((t) => t.id) }, usedAt: null } });
  }

  private async issueToken(userId: string, purpose: AuthTokenPurpose, ttlMs: number) {
    const token = randomToken();
    // 이전에 보낸 같은 목적의 토큰은 무효화한다 (마지막 메일의 링크만 유효)
    await this.prisma.authToken.deleteMany({ where: { userId, purpose, usedAt: null } });
    await this.prisma.authToken.create({
      data: { tokenHash: hashToken(token), purpose, userId, expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  /** 1회용 — 사용 처리와 확인을 한 번에 해서 같은 토큰을 두 번 쓰지 못하게 한다 */
  private async consumeToken(token: string, purpose: AuthTokenPurpose) {
    const hit = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!hit || hit.purpose !== purpose || hit.usedAt || hit.expiresAt.getTime() <= Date.now()) return null;
    const { count } = await this.prisma.authToken.updateMany({
      where: { id: hit.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1 ? hit : null;
  }
}
