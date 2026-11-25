import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { Body, Controller, Get, HttpCode, Module, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { type AuthedRequest, Public } from '../common/auth';
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
const OAUTH_PROVIDERS = new Set(['kakao', 'naver', 'apple', 'google']);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** 현재 세션 — 없거나 만료면 401 (웹·앱은 비로그인으로 처리) */
  @Public()
  @Get('session')
  session(@Req() req: AuthedRequest): Session {
    if (!req.user || !req.session) throw new AppException('UNAUTHENTICATED');
    return { user: toUser(req.user), expiresAt: req.session.expiresAt.toISOString() };
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
  signup(@Body(new ZodPipe(apiInput(signupSchema))) input: SignupInput, @Req() req: Request) {
    return this.auth.signup(input, clientIp(req));
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

  /**
   * 소셜 로그인 시작. 공급자 키가 발급되기 전에는 웹 로그인 화면으로 안내한다
   * (인가 요청·state·PKCE·토큰 교환은 키 발급 후 이 경로에서 서버가 처리한다).
   */
  @Public()
  @Get('oauth/:provider/start')
  oauthStart(@Param('provider') provider: string, @Res() res: Response): void {
    if (!OAUTH_PROVIDERS.has(provider)) throw new AppException('NOT_FOUND');
    res.redirect(`${env().WEB_PUBLIC_URL}/login?error=oauth_failed`);
  }
}

@Module({
  controllers: [AuthController, SocialController],
  providers: [AuthService, SessionService, SocialService],
  exports: [SessionService],
})
export class AuthModule {}
