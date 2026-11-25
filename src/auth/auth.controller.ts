import { PhoneSignup, phoneCookie, savePhoneTicket, clearPhoneTicket } from './phone-signup';
import { SignupSms } from './signup-sms';
import { profileSchema } from '../shared/domain/schemas';
import { AdminSocial } from './admin-social';
import { SocialOnboarding } from './social-onboarding';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { Body, Controller, Get, HttpCode, Module, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { type AuthedRequest, Public, RememberDevice } from '../common/auth';
import { clientIp } from '../common/rate-limit';
import { apiInput, ZodPipe } from '../common/zod.pipe';
import { env } from '../config/env';
import {
  forgotPasswordSchema,
  type LoginInput,
  loginSchema,
  resetPasswordSchema,
  type SignupInput,
  signupSchema,
} from '../shared/domain/schemas';
import type { Session } from '../shared/domain/types';
import { toUser } from '../users/user.mapper';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

const resetConfirmSchema = z.object({ token: z.string().min(1).max(200), password: z.string() });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly phone: PhoneSignup,
    private readonly sessions: SessionService,
  ) {}

  /** 현재 세션 — 없거나 만료면 401 (웹·앱은 비로그인으로 처리) */
  @Public()
  @Get('session')
  session(@Req() req: AuthedRequest): Session {
    if (!req.user || !req.session) throw new AppException('UNAUTHENTICATED');
    return { user: toUser(req.user), expiresAt: req.session.expiresAt.toISOString() };
  }

  @RememberDevice()
  @Post('session/remember')
  @HttpCode(200)
  rememberDevice(@Req() req: AuthedRequest): Session {
    return this.session(req);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(apiInput(loginSchema))) input: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Session> {
    const { user, token, expiresAt } = await this.auth.login(input, clientIp(req), req.get('user-agent'));
    this.sessions.setCookie(res, token, expiresAt);
    return { user: toUser(user), expiresAt: expiresAt.toISOString() };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    if (req.session) await this.sessions.revoke(req.session.token);
    this.sessions.clearCookie(res);
  }

  @Public()
  @Post('signup')
  async signup(
    @Body(new ZodPipe(apiInput(signupSchema))) input: SignupInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { ticket, state } = await this.auth.signup(input, clientIp(req));
    savePhoneTicket(res, ticket);
    return { requiresPhoneVerification: true, ...state };
  }

  @Public()
  @Get('phone-verification')
  async phoneState(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.phone.view(String(req.cookies?.[phoneCookie] ?? ''));
  }
  @Public()
  @Post('phone-verification/resend')
  @HttpCode(200)
  async resendPhone(
    @Body(new ZodPipe(z.object({ phone: profileSchema.shape.phone.optional() }))) body: { phone?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { ticket, state } = await this.phone.resend(
      String(req.cookies?.[phoneCookie] ?? ''),
      body.phone,
      clientIp(req),
    );
    savePhoneTicket(res, ticket);
    return state;
  }
  @Public()
  @Post('phone-verification/confirm')
  @HttpCode(200)
  async confirmPhone(
    @Body(new ZodPipe(z.object({ code: z.string().regex(/^\d{6}$/) }))) body: { code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.phone.confirm(String(req.cookies?.[phoneCookie] ?? ''), body.code);
    clearPhoneTicket(res);
    if (result.social) {
      const session = await this.sessions.create(result.userId, req.get('user-agent'));
      this.sessions.setCookie(res, session.token, session.expiresAt);
    }
    return { signedIn: result.social };
  }

  @Public()
  @Post('email-verification/resend')
  @HttpCode(204)
  async resend(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }): Promise<void> {
    await this.auth.resendVerification(body.email);
  }

  /** 인증 메일 링크 — 결과를 웹 로그인 화면으로 넘긴다 */
  @Public()
  @Get('email-verification/confirm')
  async confirm(@Query('token') token: string | undefined, @Res() res: Response): Promise<void> {
    const ok = token ? await this.auth.confirmEmail(token) : false;
    res.redirect(`${env().WEB_PUBLIC_URL}/login${ok ? '?verified=1' : '?error=verify_expired'}`);
  }

  @Public()
  @Post('password-reset')
  @HttpCode(204)
  async requestReset(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }): Promise<void> {
    await this.auth.requestPasswordReset(body.email);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmReset(
    @Body(new ZodPipe(resetConfirmSchema)) body: z.infer<typeof resetConfirmSchema>,
  ): Promise<void> {
    // 비밀번호 규칙은 웹 폼 스키마와 같게 검사한다
    new ZodPipe(resetPasswordSchema).transform({ password: body.password, passwordConfirm: body.password });
    await this.auth.resetPassword(body.token, body.password);
  }
}

@Module({
  controllers: [AuthController, SocialController],
  providers: [
    AuthService,
    SessionService,
    SocialService,
    SocialOnboarding,
    AdminSocial,
    PhoneSignup,
    SignupSms,
  ],
  exports: [SessionService],
})
export class AuthModule {}
