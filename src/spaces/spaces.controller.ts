import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/auth';
import { apiInput, ZodPipe } from '../common/zod.pipe';
import { type ReservationInput, reservationSchema } from '../shared/domain/schemas';
import { SpacesService } from './spaces.service';

const dateQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: '날짜 형식을 확인해 주세요.' }),
});

@Controller()
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Public()
  @Get('spaces')
  list() {
    return this.spaces.list();
  }

  @Public()
  @Get('spaces/:id')
  get(@Param('id') id: string) {
    return this.spaces.get(id);
  }

  @Public()
  @Get('spaces/:id/availability')
  availability(@Param('id') id: string, @Query(new ZodPipe(dateQuery)) q: z.infer<typeof dateQuery>) {
    return this.spaces.availability(id, q.date);
  }

  @Post('spaces/:id/reservations')
  reserve(
    @CurrentUser() me: UserRow,
    @Param('id') id: string,
    @Body(new ZodPipe(apiInput(reservationSchema))) input: ReservationInput,
  ) {
    return this.spaces.reserve(me, id, input);
  }

  @Get('me/reservations')
  mine(@CurrentUser() me: UserRow) {
    return this.spaces.mine(me.id);
  }

  @Post('me/reservations/:id/cancel')
  cancel(@CurrentUser() me: UserRow, @Param('id') id: string) {
    return this.spaces.cancel(me.id, id);
  }
}

@Module({ controllers: [SpacesController], providers: [SpacesService] })
export class SpacesModule {}
