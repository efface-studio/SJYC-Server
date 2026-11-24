import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { OAuthProvider } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { type AuthedRequest, Public } from '../common/auth';
import { clientIp, RateLimitService } from '../common/rate-limit';
import { ZodPipe } from '../common/zod.pipe';
import { SessionService } from './session.service';
import { configured } from './social-provider';
import { SocialService } from './social.service';

const providerPipe = new ZodPipe(z.enum(OAuthProvider));
const token = z.string().regex(/^[a-zA-Z0-9_-]{43}$/);
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
  status(@Req() req: AuthedRequest) {
    return this.social.status(req.user!.id);
  }

  @Public()
  @Get('auth/social/providers')
  providers() {
    return Object.values(OAuthProvider).filter(configured);
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

  @Public()
  @Get('auth/social/:provider/callback')
  async callback(
    @Param('provider', providerPipe) provider: OAuthProvider,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    const input = z.object({ state: token, code: z.string().min(1).max(4096) }).safeParse(query);
    try {
      if (input.success) {
        const receipt = await this.social.callback(provider, input.data.state, input.data.code);
        return res.redirect('sjyc://oauth-return?receipt=' + encodeURIComponent(receipt));
      }
    } catch {
      /* 공급자 오류 응답이나 개인정보를 리다이렉트에 싣지 않는다. */
    }
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
    if (!req.user) {
      const session = await this.sessions.create(id, req.get('user-agent'));
      this.sessions.setCookie(res, session.token, session.expiresAt);
    }
    return { signedIn: true };
  }

  @Delete('me/social/:provider')
  unlink(@Param('provider', providerPipe) provider: OAuthProvider, @Req() req: AuthedRequest) {
    return this.social.unlink(req.user!.id, provider);
  }
}
