import { Global, Injectable, Module } from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service';

/** 고정 창(window) 카운터. 한도를 넘었으면 true */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async exceeded(key: string, limit: number, windowSec: number): Promise<boolean> {
    const k = `rl:${key}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, windowSec);
    return n > limit;
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}

@Global()
@Module({ providers: [RateLimitService], exports: [RateLimitService] })
export class RateLimitModule {}

/** 프록시 뒤에서도 실제 IP (trust proxy 설정 기준) */
export const clientIp = (req: Request) => req.ip ?? 'unknown';
