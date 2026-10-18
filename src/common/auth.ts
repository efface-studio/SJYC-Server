import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { SESSION_COOKIE, SessionService, type AuthUser } from '../auth/session.service';
import { can, type Permission } from '../shared/domain/permissions';
import { AppException } from './app-exception';

export type AuthedRequest = Request & {
  user?: AuthUser;
  session?: { token: string; expiresAt: Date };
};

const PUBLIC = 'auth:public';
const PERMISSION = 'auth:permission';

/** 로그인 없이 접근 가능 (세션이 있으면 req.user 는 채운다) */
export const Public = () => SetMetadata(PUBLIC, true);

/** 이 권한이 있어야 한다 — 서버가 요청마다 판단한다 (화면 메뉴 숨김은 보안 경계가 아니다) */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION, permission);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});

/** 전역 가드. 기본은 로그인 필요. 세션은 HttpOnly 쿠키로만 받는다 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      const s = await this.sessions.resolve(token);
      if (s) {
        req.user = s.user;
        req.session = { token, expiresAt: s.expiresAt };
        if (s.renewed)
          this.sessions.setCookie(ctx.switchToHttp().getResponse<Response>(), token, s.expiresAt);
      }
    }

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    if (!req.user) throw new AppException('UNAUTHENTICATED');
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION, targets);
    if (permission && !can(req.user, permission)) throw new AppException('FORBIDDEN');
    return true;
  }
}
