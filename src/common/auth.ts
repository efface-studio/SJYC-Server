import { checkContact, readContact } from '../auth/login-contact';
import { hasVerifiedContact, defersOperatorContact } from '../auth/operator-login';
import { canEnterConsole } from '../shared/domain/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { checkActivity, type Activity } from '../operations/developer-controls';
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

export const OpenActivity = (activity: Activity) => SetMetadata('center:activity', activity);
const REMEMBER_DEVICE = 'auth:remember-device';
export const RememberDevice = () => SetMetadata(REMEMBER_DEVICE, true);
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
    private readonly db: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      const remember = this.reflector.get<boolean>(REMEMBER_DEVICE, ctx.getHandler()) === true;
      const s = await this.sessions.resolve(token, remember);
      if (s) {
        const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION, targets);
        const path: string = typeof req.route?.path === 'string' ? req.route.path : req.path;
        const sessionCheck = path.endsWith('/auth/session') || path.endsWith('/auth/session/remember');
        const adminSurface =
          !!permission ||
          /^\/(?:api\/v1\/)?admin(?:\/|$)/.test(path) ||
          (sessionCheck && req.query.audience === 'admin');
        if (adminSurface && !canEnterConsole(s.user)) throw new AppException('FORBIDDEN');
        if (adminSurface && s.audience !== 'admin') {
          const { rule } = await readContact(this.db, 'admin');
          checkContact(rule, s.user);
          if (!rule && !hasVerifiedContact(s.user) && !defersOperatorContact(s.user))
            throw new AppException('FORBIDDEN');
        } else if (s.audience === 'admin' && sessionCheck && req.query.audience === 'user') {
          checkContact((await readContact(this.db, 'user')).rule, s.user);
        }
        req.user = s.user;
        req.session = { token, expiresAt: s.expiresAt };
        if (s.renewed || remember)
          this.sessions.setCookie(ctx.switchToHttp().getResponse<Response>(), token, s.expiresAt);
      }
    }

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    if (!req.user) throw new AppException('UNAUTHENTICATED');
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION, targets);
    if (permission && !can(req.user, permission)) throw new AppException('FORBIDDEN');
    const activity = this.reflector.get<Activity>('center:activity', ctx.getHandler());
    if (activity) await checkActivity(this.db, activity);
    return true;
  }
}
