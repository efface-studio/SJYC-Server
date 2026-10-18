import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './auth/auth.controller';
import { AuthGuard } from './common/auth';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { RateLimitModule } from './common/rate-limit';
import { HealthModule } from './health/health.controller';
import { MailModule } from './mail/mail.service';
import { MeModule } from './me/me.controller';
import { NotificationsModule } from './notifications/notifications.service';
import { ContentModule } from './content/content.controller';
import { AdminModule } from './admin/admin.controller';
import { AttendanceModule } from './attendance/attendance.controller';
import { AuditModule } from './audit/audit.service';
import { ClubsModule } from './clubs/clubs.controller';
import { ManageModule } from './manage/manage.controller';
import { ProgramsModule } from './programs/programs.controller';
import { SpacesModule } from './spaces/spaces.controller';
import { PrismaModule } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.service';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    RateLimitModule,
    MailModule,
    NotificationsModule,
    HealthModule,
    AuthModule,
    MeModule,
    ProgramsModule,
    SpacesModule,
    ClubsModule,
    ContentModule,
    AuditModule,
    AdminModule,
    AttendanceModule,
    ManageModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
