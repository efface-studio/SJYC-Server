import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';

/** rate limit·출석 코드 시도 횟수 등 짧게 쓰는 값 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    super(env().REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
  }
  async onModuleDestroy() {
    await this.quit();
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
