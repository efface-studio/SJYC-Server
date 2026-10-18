import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

/** 성공 응답을 `{ success: true, data }` 로 감싼다. 204(본문 없음)는 그대로 둔다 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data: unknown) => {
        const res = ctx.switchToHttp().getResponse<Response>();
        if (res.statusCode === 204) return undefined;
        return { success: true, data: data ?? null };
      }),
    );
  }
}
