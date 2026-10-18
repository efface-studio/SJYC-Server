import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/auth';
import { apiInput, pageQuery, ZodPipe } from '../common/zod.pipe';
import { type InquiryInput, inquirySchema } from '../shared/domain/schemas';
import { ContentService, type NoticeQuery } from './content.service';

const noticeQuery = pageQuery.extend({
  q: z.string().max(100).optional(),
  category: z.enum(['center', 'youth', 'education']).optional().catch(undefined),
  pageSize: z.coerce.number().int().min(1).max(50).catch(10).default(10),
});

@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('notices')
  notices(@Query(new ZodPipe(noticeQuery)) q: NoticeQuery) {
    return this.content.notices(q);
  }

  @Public()
  @Get('notices/:id')
  notice(@Param('id') id: string) {
    return this.content.notice(id);
  }

  @Public()
  @Get('faqs')
  faqs() {
    return this.content.faqs();
  }

  @Public()
  @Get('policies/:key')
  policy(@Param('key') key: string) {
    return this.content.policy(key);
  }

  @Public()
  @Get('media')
  media() {
    return this.content.media();
  }

  @Post('inquiries')
  createInquiry(@CurrentUser() me: UserRow, @Body(new ZodPipe(apiInput(inquirySchema))) input: InquiryInput) {
    return this.content.createInquiry(me, input);
  }

  @Get('me/inquiries')
  myInquiries(@CurrentUser() me: UserRow) {
    return this.content.myInquiries(me.id);
  }

  @Get('me/inquiries/:id')
  myInquiry(@CurrentUser() me: UserRow, @Param('id') id: string) {
    return this.content.myInquiry(me.id, id);
  }
}

@Module({ controllers: [ContentController], providers: [ContentService], exports: [ContentService] })
export class ContentModule {}
