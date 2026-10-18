import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { decisionBody, type DecisionBody } from '../admin/admin-ops.controller';
import { AdminModule } from '../admin/admin.controller';
import { AttendanceModule } from '../attendance/attendance.controller';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser } from '../common/auth';
import { apiInput, ZodPipe } from '../common/zod.pipe';
import {
  type ClubIntroInput,
  clubIntroSchema,
  type ClubPostInput,
  clubPostSchema,
} from '../shared/domain/schemas';
import { ManageService } from './manage.service';

const roleBody = z.object({ role: z.enum(['leader', 'member']) });

/** 동아리 담당자 운영 — 권한(canManageClub)은 서비스가 동아리마다 검사한다 */
@Controller('manage/clubs')
export class ManageController {
  constructor(private readonly manage: ManageService) {}

  @Get()
  clubs(@CurrentUser() me: AuthUser) {
    return this.manage.clubs(me);
  }

  @Get(':clubId/members')
  roster(@CurrentUser() me: AuthUser, @Param('clubId') clubId: string) {
    return this.manage.roster(me, clubId);
  }

  @Patch(':clubId/members/:userId')
  setMemberRole(
    @CurrentUser() me: AuthUser,
    @Param('clubId') clubId: string,
    @Param('userId') userId: string,
    @Body(new ZodPipe(roleBody)) body: z.infer<typeof roleBody>,
  ) {
    return this.manage.setMemberRole(me, clubId, userId, body.role);
  }

  @Delete(':clubId/members/:userId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() me: AuthUser,
    @Param('clubId') clubId: string,
    @Param('userId') userId: string,
  ) {
    return this.manage.removeMember(me, clubId, userId);
  }

  @Get(':clubId/applications')
  applications(@CurrentUser() me: AuthUser, @Param('clubId') clubId: string) {
    return this.manage.applications(me, clubId);
  }

  @Post(':clubId/applications/:id/decision')
  @HttpCode(200)
  decide(
    @CurrentUser() me: AuthUser,
    @Param('clubId') clubId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(decisionBody)) body: DecisionBody,
  ) {
    return this.manage.decideApplication(me, clubId, id, body.decision, body.reason ?? null);
  }

  @Patch(':clubId/intro')
  updateIntro(
    @CurrentUser() me: AuthUser,
    @Param('clubId') clubId: string,
    @Body(new ZodPipe(apiInput(clubIntroSchema))) input: ClubIntroInput,
  ) {
    return this.manage.updateIntro(me, clubId, input);
  }

  @Post(':clubId/posts')
  createPost(
    @CurrentUser() me: AuthUser,
    @Param('clubId') clubId: string,
    @Body(new ZodPipe(clubPostSchema)) input: ClubPostInput,
  ) {
    return this.manage.createPost(me, clubId, input);
  }

  @Delete(':clubId/posts/:postId')
  @HttpCode(204)
  removePost(@CurrentUser() me: AuthUser, @Param('clubId') clubId: string, @Param('postId') postId: string) {
    return this.manage.removePost(me, clubId, postId);
  }
}

@Module({
  imports: [AdminModule, AttendanceModule],
  controllers: [ManageController],
  providers: [ManageService],
})
export class ManageModule {}
