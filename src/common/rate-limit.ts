import { Global, Injectable, Module } from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service';

// 증가와 만료를 한 번에 적용하고, 이전 버전에서 만료가 누락된 키도 복구한다.
const INCREMENT_WINDOW = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

/** 고정 창(window) 카운터. 한도를 넘었으면 true */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async exceeded(key: string, limit: number, windowSec: number): Promise<boolean> {
    const k = `rl:${key}`;
    const count = await this.redis.eval(INCREMENT_WINDOW, 1, k, windowSec);
    return Number(count) > limit;
  }

  /** 현재 창의 횟수 (늘리지 않고 확인만) */
  async count(key: string): Promise<number> {
    return Number((await this.redis.get(`rl:${key}`)) ?? 0);
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
