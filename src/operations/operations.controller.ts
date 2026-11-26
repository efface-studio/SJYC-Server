import { DeveloperConsole } from './developer-console';
import { Body, Controller, Get, Module, Put } from '@nestjs/common';
import type { User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public, RequirePermission } from '../common/auth';
import { AppException } from '../common/app-exception';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { settingsSchema, settingsWriteSchema, type SettingsRecord } from '../shared/domain/site-settings';
import { policyKey, readContact } from '../auth/login-contact';
import {
  contactPatch,
  type ContactPatch,
  type ContactSettings,
  audienceLabels,
} from '../shared/domain/login-contact';
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
  @RequirePermission('site.manage')
  @Get('admin/login-contact')
  async loginContact(): Promise<ContactSettings> {
    const [user, admin] = await Promise.all([
      readContact(this.prisma, 'user'),
      readContact(this.prisma, 'admin'),
    ]);
    return { user, admin };
  }
  @RequirePermission('site.manage')
  @Put('admin/login-contact')
  async setLoginContact(@CurrentUser() actor: User, @Body(new ZodPipe(contactPatch)) input: ContactPatch) {
    const { audience, version, ...rule } = input,
      id = policyKey(audience);
    await this.prisma.$transaction(async (tx) => {
      const before = await readContact(tx, audience);
      const saved =
        version === 0
          ? await tx.siteSettings.createMany({
              data: [{ id, values: rule, version: 1 }],
              skipDuplicates: true,
            })
          : await tx.siteSettings.updateMany({
              where: { id, version },
              data: { values: rule, version: { increment: 1 } },
            });
      if (saved.count !== 1)
        throw new AppException('CONFLICT', '다른 관리자가 변경했습니다. 최신 설정을 확인해 주세요.');
      await this.audit.record(
        actor,
        {
          action: 'auth.contact-policy.update',
          targetType: 'site_settings',
          targetId: id,
          summary: audienceLabels[audience] + ' 미인증 로그인 정책 변경',
        },
        tx,
        { before: JSON.stringify(before.rule), after: JSON.stringify(rule) },
      );
    });
    return this.loginContact();
  }
  @RequirePermission('developer.access')
  @Get('admin/server-logs')
  logs() {
    return recentServerLogs();
  }
}
@Module({ controllers: [OperationsController, DeveloperConsole] })
export class OperationsModule {}
