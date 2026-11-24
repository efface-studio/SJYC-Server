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
import { SocialService, UnlinkedSocialAccount } from './social.service';

const providerPipe = new ZodPipe(z.enum(OAuthProvider));
const token = z.string().regex(/^[a-zA-Z0-9_-]{43}$/);
const webState = z.string().regex(/^web\.[a-zA-Z0-9_-]{43}$/);
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

const finishInput = z.object({ receipt: token, claim: token });
type Finish = z.infer<typeof finishInput>;

@Controller()
export class SocialController {
  constructor(
    private readonly social: SocialService,
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
    @Body(new ZodPipe(z.object({ state: token, identityToken: z.string().min(1).max(16384) })))
    body: { state: string; identityToken: string },
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const id = await this.social.finishNativeApple(body.state, body.identityToken, req.user?.id ?? null);
    if (!req.user) await this.signIn(id, req, res);
    return { signedIn: true };
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
  ) {
    if (await this.limiter.exceeded('social:' + clientIp(req), 30, 600))
      throw new AppException('RATE_LIMITED');
    const { url, claim } = await this.social.start(provider, link ? req.user!.id : null, true);
    const state = new URL(url).searchParams.get('state');
    const destination = new URL(webDestination(next));
    res.cookie(
      'sjyc_oauth_' + provider,
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
    const web = webState.safeParse(query.state).success;
    const cookieName = 'sjyc_oauth_' + provider;
    const browser = webCookie.safeParse(req.cookies?.[cookieName]);
    const failed = env().WEB_PUBLIC_URL + '/login?error=';
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
      .object({ state: web ? webState : token, code: z.string().min(1).max(4096) })
      .safeParse(query);
    try {
      if (input.success) {
        const receipt = await this.social.callback(provider, input.data.state, input.data.code);
        if (web && browser.success) {
          const id = await this.social.finish(receipt, browser.data.claim, req.user?.id ?? null);
          if (!req.user) await this.signIn(id, req, res);
          return res.redirect(webDestination(browser.data.next));
        }
        return res.redirect('sjyc://oauth-return?receipt=' + encodeURIComponent(receipt));
      }
    } catch (error) {
      if (web && error instanceof UnlinkedSocialAccount) return res.redirect(failed + 'oauth_unlinked');
      /* 공급자 오류 응답이나 개인정보를 리다이렉트에 싣지 않는다. */
    }
    if (web)
      return res.redirect(failed + (query.error === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed'));
    return res.redirect('sjyc://oauth-return?error=cancelled');
  }

  @Public()
  @Post('auth/social/complete')
  async finish(
    @Body(new ZodPipe(finishInput)) input: Finish,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const id = await this.social.finish(input.receipt, input.claim, req.user?.id ?? null);
    if (!req.user) await this.signIn(id, req, res);
    return { signedIn: true };
  }

  @Delete('me/social/:provider')
  unlink(@Param('provider', providerPipe) provider: OAuthProvider, @Req() req: AuthedRequest) {
    return this.social.unlink(req.user!.id, provider);
  }
}
