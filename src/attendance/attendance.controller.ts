import { attendancePosition, scanInput, type AttendanceScan } from '../shared/domain/check-in-location';
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { attendanceSessionSchema, checkInSchema } from '../shared/domain/schemas';
import { AttendanceService } from './attendance.service';

const target = z.object({
  targetType: z.enum(['club', 'program']),
  targetId: z.string().min(1).max(64),
});
const createBody = target.extend(attendanceSessionSchema.shape);
const marksBody = z.object({
  marks: z
    .array(
      z.object({
        userId: z.string().min(1).max(64),
        status: z.enum(['present', 'late', 'absent', 'excused']).nullable(),
        note: z.string().max(100).nullish(),
      }),
    )
    .min(1)
    .max(500),
});
const checkInToggle = z.object({ open: z.boolean(), position: attendancePosition.optional() });

type Target = z.infer<typeof target>;
const asTarget = (t: Target) => ({ type: t.targetType, id: t.targetId });

/** 출석부 — 권한은 대상별로 서비스가 검사한다 (센터 직원 이상 또는 그 동아리 담당자) */
@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('attendance/targets')
  targets(@CurrentUser() me: AuthUser) {
    return this.attendance.targets(me);
  }

  @Get('attendance/sessions')
  sessions(@CurrentUser() me: AuthUser, @Query(new ZodPipe(target)) q: Target) {
    return this.attendance.sessions(me, asTarget(q));
  }

  @Get('attendance/sessions/:id')
  get(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.attendance.get(me, id);
  }

  @Post('attendance/sessions')
  create(@CurrentUser() me: AuthUser, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>) {
    return this.attendance.create(me, asTarget(body), { date: body.date, title: body.title });
  }

  @Delete('attendance/sessions/:id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.attendance.remove(me, id);
  }

  @Put('attendance/sessions/:id/records')
  mark(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(marksBody)) body: z.infer<typeof marksBody>,
  ) {
    return this.attendance.mark(me, id, body.marks);
  }

  @Post('attendance/sessions/:id/check-in')
  @HttpCode(200)
  setCheckIn(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(checkInToggle)) body: z.infer<typeof checkInToggle>,
  ) {
    return this.attendance.setCheckIn(me, id, body.open, body.position);
  }

  @Get('attendance/stats')
  stats(@CurrentUser() me: AuthUser, @Query(new ZodPipe(target)) q: Target) {
    return this.attendance.stats(me, asTarget(q));
  }

  @Get('me/attendance')
  mine(@CurrentUser() me: AuthUser) {
    return this.attendance.mine(me.id);
  }

  @Post('me/attendance/scan')
  @HttpCode(200)
  scan(@CurrentUser() me: AuthUser, @Body(new ZodPipe(scanInput)) body: AttendanceScan) {
    return this.attendance.scan(me.id, body);
  }

  @Post('me/attendance/check-in')
  @HttpCode(200)
  checkIn(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(checkInSchema)) body: z.infer<typeof checkInSchema>,
  ) {
    return this.attendance.checkIn(me.id, body.code);
  }
}

@Module({ controllers: [AttendanceController], providers: [AttendanceService], exports: [AttendanceService] })
export class AttendanceModule {}
