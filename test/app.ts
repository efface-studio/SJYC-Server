import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { createApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

export interface TestContext {
  app: INestApplication;
  http: ReturnType<typeof supertest>;
  prisma: PrismaService;
  redis: RedisService;
}

/** 실제 DB·Redis 로 앱을 띄운다. 외부 연동은 기능별로 테스트 더블로 교체한다 */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = await createApp(moduleRef);
  await app.init();
  const redis = app.get(RedisService);
  // 안전장치: db 0 은 개발 서버가 쓰는 자리 — 비우지 않고 실패한다
  if ((redis.options.db ?? 0) === 0) {
    await app.close();
    throw new Error(`테스트 Redis 는 db 0 이 아니어야 합니다 (REDIS_URL_TEST): ${process.env.REDIS_URL}`);
  }
  await redis.flushdb();
  return { app, http: supertest(app.getHttpServer()), prisma: app.get(PrismaService), redis };
}
