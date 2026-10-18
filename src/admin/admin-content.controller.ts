import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { CurrentUser, RequirePermission } from '../common/auth';
import { apiInput, ZodPipe } from '../common/zod.pipe';
import {
  type FaqFormInput,
  faqFormSchema,
  type NoticeFormInput,
  noticeFormSchema,
  type PolicyFormInput,
  policyFormSchema,
  type ProgramFormInput,
  programFormSchema,
} from '../shared/domain/schemas';
import { AdminContentService } from './admin-content.service';
import { type AdminListQuery, adminListQuery } from './admin-query';

const listQuery = new ZodPipe(adminListQuery);

@Controller('admin')
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @RequirePermission('notice.write')
  @Get('notices')
  notices(@Query(listQuery) q: AdminListQuery) {
    return this.content.notices(q);
  }

  @RequirePermission('notice.write')
  @Get('notices/:id')
  notice(@Param('id') id: string) {
    return this.content.notice(id);
  }

  @RequirePermission('notice.write')
  @Post('notices')
  createNotice(
    @CurrentUser() me: UserRow,
    @Body(new ZodPipe(apiInput(noticeFormSchema))) input: NoticeFormInput,
  ) {
    return this.content.createNotice(me, input);
  }

  @RequirePermission('notice.write')
  @Put('notices/:id')
  updateNotice(
    @CurrentUser() me: UserRow,
    @Param('id') id: string,
    @Body(new ZodPipe(apiInput(noticeFormSchema))) input: NoticeFormInput,
  ) {
    return this.content.updateNotice(me, id, input);
  }

  @RequirePermission('notice.write')
  @Delete('notices/:id')
  @HttpCode(204)
  removeNotice(@CurrentUser() me: UserRow, @Param('id') id: string) {
    return this.content.removeNotice(me, id);
  }

  @RequirePermission('program.write')
  @Get('programs')
  programs(@Query(listQuery) q: AdminListQuery) {
    return this.content.programs(q);
  }

  @RequirePermission('program.write')
  @Get('programs/:id')
  program(@Param('id') id: string) {
    return this.content.program(id);
  }

  @RequirePermission('program.write')
  @Post('programs')
  createProgram(
    @CurrentUser() me: UserRow,
    @Body(new ZodPipe(apiInput(programFormSchema))) input: ProgramFormInput,
  ) {
    return this.content.createProgram(me, input);
  }

  @RequirePermission('program.write')
  @Put('programs/:id')
  updateProgram(
    @CurrentUser() me: UserRow,
    @Param('id') id: string,
    @Body(new ZodPipe(apiInput(programFormSchema))) input: ProgramFormInput,
  ) {
    return this.content.updateProgram(me, id, input);
  }

  @RequirePermission('program.write')
  @Delete('programs/:id')
  @HttpCode(204)
  removeProgram(@CurrentUser() me: UserRow, @Param('id') id: string) {
    return this.content.removeProgram(me, id);
  }

  @RequirePermission('inquiry.answer')
  @Get('faqs')
  faqs() {
    return this.content.faqs();
  }

  @RequirePermission('inquiry.answer')
  @Post('faqs')
  createFaq(@CurrentUser() me: UserRow, @Body(new ZodPipe(apiInput(faqFormSchema))) input: FaqFormInput) {
    return this.content.createFaq(me, input);
  }

  @RequirePermission('inquiry.answer')
  @Put('faqs/:id')
  updateFaq(
    @CurrentUser() me: UserRow,
    @Param('id') id: string,
    @Body(new ZodPipe(apiInput(faqFormSchema))) input: FaqFormInput,
  ) {
    return this.content.updateFaq(me, id, input);
  }

  @RequirePermission('inquiry.answer')
  @Delete('faqs/:id')
  @HttpCode(204)
  removeFaq(@CurrentUser() me: UserRow, @Param('id') id: string) {
    return this.content.removeFaq(me, id);
  }

  @RequirePermission('policy.manage')
  @Get('policies')
  policies() {
    return this.content.policies();
  }

  @RequirePermission('policy.manage')
  @Put('policies/:key')
  updatePolicy(
    @CurrentUser() me: UserRow,
    @Param('key') key: string,
    @Body(new ZodPipe(policyFormSchema)) input: PolicyFormInput,
  ) {
    return this.content.updatePolicy(me, key, input);
  }
}
