import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { createApp } from '../src/bootstrap';
import { MailService, type MailMessage } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

/** 보낸 메일을 메모리에 남기는 더블 */
export class FakeMail {
  sent: MailMessage[] = [];
  send(msg: MailMessage) {
    this.sent.push(msg);
    return Promise.resolve();
  }
  /** 마지막 메일 본문에서 token 값 */
  lastToken(to: string): string | undefined {
    const msg = [...this.sent].reverse().find((m) => m.to === to);
    return msg?.text.match(/token=([\w-]+)/)?.[1];
  }
}

export interface TestContext {
  app: INestApplication;
  http: ReturnType<typeof supertest>;
  prisma: PrismaService;
  redis: RedisService;
  mail: FakeMail;
}

/** 실제 DB·Redis 로 앱을 띄운다. 외부 연동(메일)은 테스트 더블로 교체한다 */
export async function createTestApp(): Promise<TestContext> {
  const mail = new FakeMail();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
  const app = await createApp(moduleRef);
  await app.init();
  const redis = app.get(RedisService);
  // 안전장치: db 0 은 개발 서버가 쓰는 자리 — 비우지 않고 실패한다
  if ((redis.options.db ?? 0) === 0) {
    await app.close();
    throw new Error(`테스트 Redis 는 db 0 이 아니어야 합니다 (REDIS_URL_TEST): ${process.env.REDIS_URL}`);
  }
  await redis.flushdb();
  return { app, http: supertest(app.getHttpServer()), prisma: app.get(PrismaService), redis, mail };
}

/** rate limit 이 테스트 사이에 누적되지 않게 비운다 (한도 자체는 별도 테스트에서 확인) */
export async function clearRateLimits(t: TestContext) {
  const keys = await t.redis.keys('rl:*');
  if (keys.length) await t.redis.del(...keys);
}
