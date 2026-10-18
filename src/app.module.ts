import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { RateLimitModule } from './common/rate-limit';
import { HealthModule } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.service';

@Module({
  imports: [PrismaModule, RedisModule, RateLimitModule, HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
