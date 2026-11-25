import { AdminSocial } from './admin-social';
import { loginSchema, type LoginInput } from '../shared/domain/schemas';
import { SocialOnboarding, onboardingInput } from './social-onboarding';
import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { OAuthProvider } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { type AuthedRequest, Public } from '../common/auth';
import { clientIp, RateLimitService } from '../common/rate-limit';
import { ZodPipe } from '../common/zod.pipe';
import { SessionService } from './session.service';
import { env, isProd } from '../config/env';
import { availableProviders, configured } from './social-provider';
import { SocialService } from './social.service';

const providerPipe = new ZodPipe(z.enum(OAuthProvider));
const token = z.string().regex(/^[a-zA-Z0-9_-]{43}$/);
const adminAppState = z.string().regex(/^adminapp\.[a-zA-Z0-9_-]{43}$/);
const webState = z.string().regex(/^(?:web|adminweb)\.[a-zA-Z0-9_-]{43}$/);
const webCookie = z.object({ state: webState, claim: token, next: z.string().max(1500) });

function webDestination(next: unknown) {
  const home = new URL(env().WEB_PUBLIC_URL);
  const url = new URL('/my', home);
  if (typeof next === 'string' && next.length <= 1500 && next.startsWith('/')) {
    try {
      const requested = new URL(next, home);
      if (requested.origin === home.origin && !/^\/admin(?:\/|$)/.test(requested.pathname))
        return requested.href;
    } catch {
      /* fall back to MY */
    }
  }
  return url.href;
}

function adminDestination(next: unknown) {
  const base = new URL('/admin', env().WEB_PUBLIC_URL);
  try {
    if (typeof next === 'string' && next.startsWith('/') && next.length <= 1500) {
      const url = new URL(next, base);
      if (
        url.origin === base.origin &&
        /^\/admin(?:\/|$)/.test(url.pathname) &&
        !url.pathname.startsWith('/admin/login')
      )
        return url.href;
    }
  } catch {
    /* return the console landing page */
  }
  return base.href;
}
const finishInput = z.object({ receipt: token, claim: token });
type Finish = z.infer<typeof finishInput>;

@Controller()
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly adminSocial: AdminSocial,
    private readonly onboarding: SocialOnboarding,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimitService,
  ) {}

  @Get('me/login-devices')
  devices(@Req() req: AuthedRequest) {
    return this.sessions.devices(req.user!.id, req.session!.token);
  }

  @Delete('me/login-devices/:id')
  async revokeDevice(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.sessions.revokeDevice(req.user!.id, id, req.session!.token);
    return this.sessions.devices(req.user!.id, req.session!.token);
  }

  @Get('me/social')
  status(@Req() req: AuthedRequest, @Query('platform') platform?: string) {
    return this.social.status(req.user!.id, platform === 'ios');
  }

  @Public()
  @Get('auth/social/providers')
  providers(@Query('platform') platform?: string) {
    return availableProviders(platform === 'ios');
  }

  @Public()
  @Post('auth/social/apple/native/start')
  async nativeStart(@Req() req: AuthedRequest) {
    if (await this.limiter.exceeded('social:' + clientIp(req), 30, 600))
      throw new AppException('RATE_LIMITED');
    return this.social.startNativeApple(null);
  }

  @Post('me/social/apple/native/start')
  async nativeLink(@Req() req: AuthedRequest) {
    if (await this.limiter.exceeded('social-link:' + req.user!.id, 30, 600))
      throw new AppException('RATE_LIMITED');
    return this.social.startNativeApple(req.user!.id);
  }

  @Public()
  @Post('auth/social/apple/native/complete')
  async nativeFinish(
    @Body(
      new ZodPipe(
        z.object({
          state: token,
          identityToken: z.string().min(1).max(16384),
          name: z.string().trim().max(100).optional(),
        }),
      ),
    )
    body: { state: string; identityToken: string; name?: string },
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const id = await this.social.finishNativeApple(
      body.state,
      body.identityToken,
      req.user?.id ?? null,
      body.name,
    );
    return this.resolve(id, req, res);
  }

  private readonly draftCookie = 'sjyc_social_profile';

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: isProd() || env().API_PUBLIC_URL.startsWith('https://'),
      path: new URL(env().API_PUBLIC_URL).pathname.replace(/\/$/, '') + '/auth/social/onboarding',
    };
  }

  private async resolve(
    result: { onboarding: string } | { userId: string },
    req: AuthedRequest,
    res: Response,
  ) {
    if ('onboarding' in result) {
      res.cookie(this.draftCookie, result.onboarding, { ...this.cookieOptions(), maxAge: 900000 });
      return { signedIn: false, needsProfile: true };
    }
    if (!req.user) await this.signIn(result.userId, req, res);
    return { signedIn: true, needsProfile: false };
  }

  @Public()
  @Get('auth/social/onboarding')
  draft(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.onboarding.view(String(req.cookies?.[this.draftCookie] ?? ''));
  }

  @Public()
  @Post('auth/social/onboarding/email')
  async email(
    @Req() req: AuthedRequest,
    @Body(new ZodPipe(z.object({ email: z.email().max(254) }))) body: { email: string },
  ) {
    if (await this.limiter.exceeded('social-email:' + clientIp(req), 20, 600))
      throw new AppException('RATE_LIMITED');
    await this.onboarding.requestCode(String(req.cookies?.[this.draftCookie] ?? ''), body.email);
  }

  @Public()
  @Post('auth/social/onboarding')
  async save(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(onboardingInput)) input: z.infer<typeof onboardingInput>,
  ) {
    if (req.user) throw new AppException('CONFLICT', '이미 로그인한 계정이 있습니다.');
    const id = await this.onboarding.complete(String(req.cookies?.[this.draftCookie] ?? ''), input);
    res.clearCookie(this.draftCookie, this.cookieOptions());
    await this.signIn(id, req, res);
    return { signedIn: true };
  }

  @Public()
  @Post('auth/social/apple/callback')
  async applePost(
    @Body(
      new ZodPipe(
        z.object({
          state: z.union([webState, token, adminAppState]),
          code: z.string().max(4096).optional(),
          error: z.string().max(128).optional(),
          user: z.string().max(4096).optional(),
        }),
      ),
    )
    body: { state: string; code?: string; error?: string; user?: string },
    @Res() res: Response,
  ) {
    let name: string | undefined;
    try {
      const parsed = z
        .object({
          name: z.object({
            firstName: z.string().max(50).optional(),
            lastName: z.string().max(50).optional(),
          }),
        })
        .safeParse(JSON.parse(body.user ?? '{}'));
      if (parsed.success)
        name = [parsed.data.name.lastName, parsed.data.name.firstName].filter(Boolean).join(' ');
    } catch {
      /* Apple provides the name only on initial consent. */
    }
    const handle = await this.social.relayApple({
      state: body.state,
      code: body.code,
      error: body.error,
      name,
    });
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    return res.redirect(
      303,
      env().API_PUBLIC_URL.replace(/\/$/, '') + '/auth/social/apple/callback?response=' + handle,
    );
  }

  private async signIn(id: string, req: AuthedRequest, res: Response) {
    const session = await this.sessions.create(id, req.get('user-agent'));
    this.sessions.setCookie(res, session.token, session.expiresAt);
  }

  @Public()
  @Post('auth/social/:provider/start')
  async start(@Param('provider', providerPipe) provider: OAuthProvider, @Req() req: AuthedRequest) {
    if (await this.limiter.exceeded('social:' + clientIp(req), 30, 600))
      throw new AppException('RATE_LIMITED');
    return this.social.start(provider, null);
  }

  @Post('me/social/:provider/start')
  async startLink(@Param('provider', providerPipe) provider: OAuthProvider, @Req() req: AuthedRequest) {
    if (await this.limiter.exceeded('social-link:' + req.user!.id, 30, 600))
      throw new AppException('RATE_LIMITED');
    return this.social.start(provider, req.user!.id);
  }

  private async startWeb(
    provider: OAuthProvider,
    req: AuthedRequest,
    res: Response,
    next: string,
    link: boolean,
    admin = false,
  ) {
    if (await this.limiter.exceeded('social:' + clientIp(req), 30, 600))
      throw new AppException('RATE_LIMITED');
    const { url, claim } = await this.social.start(provider, link ? req.user!.id : null, true, admin);
    const state = new URL(url).searchParams.get('state');
    const destination = new URL(admin ? adminDestination(next) : webDestination(next));
    res.cookie(
      (admin ? 'sjyc_admin_oauth_' : 'sjyc_oauth_') + provider,
      { state, claim, next: destination.pathname + destination.search + destination.hash },
      {
        path:
          new URL(env().API_PUBLIC_URL).pathname.replace(/\/$/, '') +
          '/auth/social/' +
          provider +
          '/callback',
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd() || env().API_PUBLIC_URL.startsWith('https://'),
        maxAge: 600_000,
      },
    );
    return url;
  }

  @Public()
  @Get('auth/admin-social/:provider/web-start')
  async adminStartWeb(
    @Param('provider', providerPipe) provider: OAuthProvider,
    @Query('redirect') next: string,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    if (!configured(provider)) return res.redirect(env().WEB_PUBLIC_URL + '/admin/login?error=oauth_failed');
    return res.redirect(await this.startWeb(provider, req, res, next, false, true));
  }

  @Public()
  @Post('auth/admin-social/:provider/start')
  async adminStart(@Param('provider', providerPipe) provider: OAuthProvider, @Req() req: AuthedRequest) {
    if (await this.limiter.exceeded('social:' + clientIp(req), 30, 600))
      throw new AppException('RATE_LIMITED');
    return this.social.start(provider, null, false, true);
  }

  @Public()
  @Post('auth/admin-social/complete')
  async adminFinish(
    @Body(new ZodPipe(finishInput)) input: Finish,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const identity = await this.social.adminProof(input.receipt, input.claim);
    return this.adminSocial.finish(identity, req.get('user-agent'), res);
  }

  @Public()
  @Get('auth/admin-social/link')
  adminLinkState(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store');
    return this.adminSocial.view(req.cookies);
  }

  @Public()
  @Post('auth/admin-social/link')
  adminLink(
    @Body(new ZodPipe(loginSchema)) input: LoginInput,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.adminSocial.link(req.cookies, input, clientIp(req), req.get('user-agent'), res);
  }

  @Public()
  @Get('auth/oauth/:provider/start')
  async webLogin(
    @Param('provider', providerPipe) provider: OAuthProvider,
    @Query('redirect') next: string,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    if (!configured(provider)) return res.redirect(env().WEB_PUBLIC_URL + '/login?error=oauth_failed');
    if (req.user) return res.redirect(webDestination(next));
    return res.redirect(await this.startWeb(provider, req, res, next, false));
  }

  @Post('me/social/:provider/web-start')
  async webLink(
    @Param('provider', providerPipe) provider: OAuthProvider,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return { url: await this.startWeb(provider, req, res, '/my/profile', true) };
  }

  @Public()
  @Get('auth/social/:provider/callback')
  async callback(
    @Param('provider', providerPipe) provider: OAuthProvider,
    @Query() query: Record<string, unknown>,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    let appleName: string | undefined;
    if (provider === 'apple' && token.safeParse(query.response).success) {
      try {
        query = await this.social.readAppleRelay(String(query.response));
        appleName = typeof query.name === 'string' ? query.name : undefined;
      } catch {
        return res.redirect(env().WEB_PUBLIC_URL + '/login?error=oauth_expired');
      }
    }
    const web = webState.safeParse(query.state).success;
    const admin =
      typeof query.state === 'string' &&
      (query.state.startsWith('adminweb.') || query.state.startsWith('adminapp.'));
    const mobileReturn = admin ? 'sjyc-admin://oauth-return' : 'sjyc://oauth-return';
    const cookieName = (admin ? 'sjyc_admin_oauth_' : 'sjyc_oauth_') + provider;
    const browser = webCookie.safeParse(req.cookies?.[cookieName]);
    const failed = env().WEB_PUBLIC_URL + (admin ? '/admin/login?error=' : '/login?error=');
    if (web) {
      if (!browser.success || browser.data.state !== query.state)
        return res.redirect(failed + 'oauth_expired');
      res.clearCookie(cookieName, {
        path: req.path,
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd() || env().API_PUBLIC_URL.startsWith('https://'),
      });
    }
    const input = z
      .object({ state: web ? webState : admin ? adminAppState : token, code: z.string().min(1).max(4096) })
      .safeParse(query);
    try {
      if (input.success) {
        const receipt = await this.social.callback(provider, input.data.state, input.data.code, appleName);
        if (web && browser.success) {
          if (admin) {
            const result = await this.adminSocial.finish(
              await this.social.adminProof(receipt, browser.data.claim),
              req.get('user-agent'),
              res,
            );
            if (result.signedIn) return res.redirect(adminDestination(browser.data.next));
            const page = new URL('/admin/login/link', env().WEB_PUBLIC_URL);
            page.searchParams.set('next', browser.data.next);
            return res.redirect(page.href);
          }
          const id = await this.social.finish(receipt, browser.data.claim, req.user?.id ?? null);
          const result = await this.resolve(id, req, res);
          if (result.needsProfile) {
            const page = new URL('/oauth/profile', env().WEB_PUBLIC_URL);
            page.searchParams.set('next', browser.data.next);
            return res.redirect(page.href);
          }
          return res.redirect(webDestination(browser.data.next));
        }
        return res.redirect(mobileReturn + '?receipt=' + encodeURIComponent(receipt));
      }
    } catch {
      /* 공급자 오류 응답이나 개인정보를 리다이렉트에 싣지 않는다. */
    }
    if (web)
      return res.redirect(failed + (query.error === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed'));
    return res.redirect(mobileReturn + '?error=cancelled');
  }

  @Public()
  @Post('auth/social/complete')
  async finish(
    @Body(new ZodPipe(finishInput)) input: Finish,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const id = await this.social.finish(input.receipt, input.claim, req.user?.id ?? null);
    return this.resolve(id, req, res);
  }

  @Delete('me/social/:provider')
  unlink(@Param('provider', providerPipe) provider: OAuthProvider, @Req() req: AuthedRequest) {
    return this.social.unlink(req.user!.id, provider);
  }
}
