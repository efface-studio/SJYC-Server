import { Body, Controller, Get, Module, Param, Patch, Query } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { z } from 'zod';
import { AuthModule } from '../auth/auth.controller';
import { CurrentUser, RequirePermission } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { type AdminListQuery, adminListQuery } from './admin-query';
import { AdminService, type MemberPatch } from './admin.service';

const dashboardQuery = z.object({
  periodDays: z.coerce.number().int().min(1).max(365).catch(7).default(7),
});

const auditQuery = adminListQuery.extend({
  pageSize: z.coerce.number().int().min(1).max(50).catch(20).default(20),
});

const memberPatch = z
  .object({
    roles: z
      .array(z.enum(['member', 'staff', 'admin', 'developer']))
      .min(1, { error: '역할을 1개 이상 지정해 주세요.' })
      .optional(),
    status: z.enum(['active', 'suspended', 'withdrawn']).optional(),
  })
  .refine((v) => v.roles || v.status, { error: '변경할 항목이 없습니다.' });

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @RequirePermission('admin.access')
  @Get('dashboard')
  dashboard(@Query(new ZodPipe(dashboardQuery)) q: z.infer<typeof dashboardQuery>) {
    return this.admin.dashboard(q.periodDays);
  }

  @RequirePermission('member.read')
  @Get('members')
  members(@Query(new ZodPipe(adminListQuery)) q: AdminListQuery) {
    return this.admin.members(q);
  }

  @RequirePermission('member.read')
  @Get('members/:id')
  member(@Param('id') id: string) {
    return this.admin.member(id);
  }

  @RequirePermission('member.manage')
  @Patch('members/:id')
  updateMember(
    @CurrentUser() me: UserRow,
    @Param('id') id: string,
    @Body(new ZodPipe(memberPatch)) patch: MemberPatch,
  ) {
    return this.admin.updateMember(me, id, patch);
  }

  @RequirePermission('audit.read')
  @Get('audit-events')
  audit(@Query(new ZodPipe(auditQuery)) q: AdminListQuery) {
    return this.admin.auditEvents(q);
  }
}

@Module({ imports: [AuthModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
