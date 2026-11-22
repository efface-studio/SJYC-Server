import { Body, Controller, Get, Module, Put } from '@nestjs/common';
import type { User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public, RequirePermission } from '../common/auth';
import { AppException } from '../common/app-exception';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { settingsSchema, settingsWriteSchema, type SettingsRecord } from '../shared/domain/site-settings';
import { recentServerLogs } from './server-logs';

@Controller()
export class OperationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  @Public()
  @Get('site/settings')
  async settings(): Promise<SettingsRecord> {
    const row = await this.prisma.siteSettings.findUnique({ where: { id: 'site' } });
    return row
      ? { version: row.version, values: settingsSchema.parse(row.values) }
      : { version: 0, values: {} };
  }
  @RequirePermission('site.manage')
  @Put('admin/site-settings')
  update(
    @CurrentUser() actor: User,
    @Body(new ZodPipe(settingsWriteSchema)) input: SettingsRecord,
  ): Promise<SettingsRecord> {
    return this.prisma.$transaction(async (tx) => {
      const { version, values } = input;
      const next = { version: version + 1, values };
      const change =
        version === 0
          ? await tx.siteSettings.createMany({ data: [{ id: 'site', ...next }], skipDuplicates: true })
          : await tx.siteSettings.updateMany({ where: { id: 'site', version }, data: next });
      if (change.count !== 1)
        throw new AppException('CONFLICT', '다른 관리자가 수정했습니다. 최신 설정을 불러와 주세요.');
      await this.audit.record(
        actor,
        {
          action: 'site.settings.update',
          targetType: 'site_settings',
          targetId: 'site',
          summary: '사이트 설정 변경',
        },
        tx,
      );
      return next;
    });
  }
  @RequirePermission('developer.access')
  @Get('admin/server-logs')
  logs() {
    return recentServerLogs();
  }
}
@Module({ controllers: [OperationsController] })
export class OperationsModule {}
