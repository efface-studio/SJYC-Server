import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../common/auth';
import { apiInput, ZodPipe } from '../common/zod.pipe';
import {
  answerSchema,
  type ClubFormInput,
  clubFormSchema,
  managerEmailSchema,
  type SpaceFormInput,
  spaceFormSchema,
} from '../shared/domain/schemas';
import { AdminOpsService } from './admin-ops.service';
import { type AdminListQuery, adminListQuery } from './admin-query';

const id = z.string().min(1).max(64);
export const decisionBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).nullish(),
});
const bulkDecisionBody = decisionBody.extend({ ids: z.array(id).min(1).max(100) });

const applicationQuery = adminListQuery.extend({ programId: id.optional() });
const reservationQuery = adminListQuery.extend({
  spaceId: id.optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
});

export type DecisionBody = z.infer<typeof decisionBody>;

@Controller('admin')
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @RequirePermission('application.decide')
  @Get('applications')
  applications(@Query(new ZodPipe(applicationQuery)) q: z.infer<typeof applicationQuery>) {
    return this.ops.applications(q);
  }

  @RequirePermission('application.decide')
  @Get('applications/:id')
  application(@Param('id') applicationId: string) {
    return this.ops.application(applicationId);
  }

  @RequirePermission('application.decide')
  @Post('applications/decisions')
  @HttpCode(200)
  decideApplications(
    @CurrentUser() me: UserRow,
    @Body(new ZodPipe(bulkDecisionBody)) body: z.infer<typeof bulkDecisionBody>,
  ) {
    return this.ops.decideApplications(me, body.ids, body.decision, body.reason ?? null);
  }

  @RequirePermission('space.manage')
  @Get('spaces')
  spaces() {
    return this.ops.spaces();
  }

  @RequirePermission('space.manage')
  @Put('spaces/:id')
  updateSpace(
    @CurrentUser() me: UserRow,
    @Param('id') spaceId: string,
    @Body(new ZodPipe(apiInput(spaceFormSchema))) input: SpaceFormInput,
  ) {
    return this.ops.updateSpace(me, spaceId, input);
  }

  @RequirePermission('space.manage')
  @Get('reservations')
  reservations(@Query(new ZodPipe(reservationQuery)) q: z.infer<typeof reservationQuery>) {
    return this.ops.reservations(q);
  }

  @RequirePermission('space.manage')
  @Post('reservations/:id/decision')
  @HttpCode(200)
  decideReservation(
    @CurrentUser() me: UserRow,
    @Param('id') reservationId: string,
    @Body(new ZodPipe(decisionBody)) body: DecisionBody,
  ) {
    return this.ops.decideReservation(me, reservationId, body.decision, body.reason ?? null);
  }

  @RequirePermission('inquiry.answer')
  @Get('inquiries')
  inquiries(@Query(new ZodPipe(adminListQuery)) q: AdminListQuery) {
    return this.ops.inquiries(q);
  }

  @RequirePermission('inquiry.answer')
  @Get('inquiries/:id')
  inquiry(@Param('id') inquiryId: string) {
    return this.ops.inquiry(inquiryId);
  }

  @RequirePermission('inquiry.answer')
  @Put('inquiries/:id/answer')
  answer(
    @CurrentUser() me: UserRow,
    @Param('id') inquiryId: string,
    @Body(new ZodPipe(answerSchema)) body: z.infer<typeof answerSchema>,
  ) {
    return this.ops.answerInquiry(me, inquiryId, body.body);
  }

  @RequirePermission('club.manage')
  @Get('clubs')
  clubs() {
    return this.ops.clubs();
  }

  @RequirePermission('club.manage')
  @Get('clubs/:id')
  club(@Param('id') clubId: string) {
    return this.ops.club(clubId);
  }

  @RequirePermission('club.manage')
  @Post('clubs')
  createClub(@CurrentUser() me: UserRow, @Body(new ZodPipe(apiInput(clubFormSchema))) input: ClubFormInput) {
    return this.ops.createClub(me, input);
  }

  @RequirePermission('club.manage')
  @Put('clubs/:id')
  updateClub(
    @CurrentUser() me: UserRow,
    @Param('id') clubId: string,
    @Body(new ZodPipe(apiInput(clubFormSchema))) input: ClubFormInput,
  ) {
    return this.ops.updateClub(me, clubId, input);
  }

  @RequirePermission('club.manage')
  @Get('club-applications')
  clubApplications(@Query(new ZodPipe(adminListQuery)) q: AdminListQuery) {
    return this.ops.clubApplications(q);
  }

  @RequirePermission('club.manage')
  @Post('club-applications/:id/decision')
  @HttpCode(200)
  decideClubApplication(
    @CurrentUser() me: UserRow,
    @Param('id') applicationId: string,
    @Body(new ZodPipe(decisionBody)) body: DecisionBody,
  ) {
    return this.ops.decideClubApplication(me, applicationId, body.decision, body.reason ?? null);
  }

  @RequirePermission('club.manage')
  @Get('clubs/:id/managers')
  managers(@Param('id') clubId: string) {
    return this.ops.managers(clubId);
  }

  @RequirePermission('club.manage')
  @Post('clubs/:id/managers')
  assignManager(
    @CurrentUser() me: UserRow,
    @Param('id') clubId: string,
    @Body(new ZodPipe(managerEmailSchema)) body: z.infer<typeof managerEmailSchema>,
  ) {
    return this.ops.assignManager(me, clubId, body.email);
  }

  @RequirePermission('club.manage')
  @Delete('clubs/:id/managers/:userId')
  @HttpCode(204)
  removeManager(@CurrentUser() me: UserRow, @Param('id') clubId: string, @Param('userId') userId: string) {
    return this.ops.removeManager(me, clubId, userId);
  }
}
