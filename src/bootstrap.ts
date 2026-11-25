import { countError } from './operations/error-metrics';
import { RedisService } from './redis/redis.service';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env, webOrigins } from './config/env';
import { captureRequest } from './operations/server-logs';
import { csrf } from './common/csrf';
import { httpLogger, logger } from './common/logger';
import { clientIp, RateLimitService } from './common/rate-limit';

export const API_PREFIX = 'api/v1';

/** main.ts 와 통합 테스트가 같은 설정으로 앱을 만든다 */
export async function createApp(testing?: TestingModule): Promise<INestApplication> {
  const e = env();
  const app = testing
    ? testing.createNestApplication<NestExpressApplication>({ logger: false })
    : await NestFactory.create<NestExpressApplication>(AppModule, {
        logger: ['error', 'warn'],
      });
  app.set('trust proxy', 1);
  // 세션 쿠키와 개인 응답이 브라우저·공유 프록시 캐시에 남지 않도록 오류 응답에도 적용한다.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.use(httpLogger);
  const metricsRedis = app.get(RedisService);
  app.use(
    captureRequest((entry) => {
      void countError(metricsRedis, entry).catch(() => {
        /* 통계 장애가 서비스 요청에 영향을 주지 않는다. */
      });
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.enableCors({ origin: webOrigins(), credentials: true, exposedHeaders: ['x-request-id'] });

  // 전역 IP rate limit — 헬스 체크 제외 (정확한 경로만 비교해 우회를 막는다)
  const limiter = app.get(RateLimitService);
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === `/${API_PREFIX}/health` || e.NODE_ENV === 'test') return next();
    try {
      if (await limiter.exceeded(`global:ip:${clientIp(req)}`, 300, 60)) {
        res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMITED', message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' },
        });
        return;
      }
    } catch (err) {
      // Redis 장애 시 요청을 막지 않는다 (가용성 우선, 개별 규칙은 서비스에서 다시 검사)
      logger.warn({ err }, '전역 rate limit 확인 실패');
    }
    next();
  });
  app.use(csrf);

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
