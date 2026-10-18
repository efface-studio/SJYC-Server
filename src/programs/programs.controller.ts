import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/auth';
import { apiInput, pageQuery, ZodPipe } from '../common/zod.pipe';
import { type ProgramApplyInput, programApplySchema } from '../shared/domain/schemas';
import { ProgramsService, type ProgramQuery } from './programs.service';

const listQuery = pageQuery.extend({
  q: z.string().max(100).optional(),
  categoryId: z.string().max(64).optional(),
  recruitStatus: z.enum(['upcoming', 'open', 'full', 'closed']).optional().catch(undefined),
  pageSize: z.coerce.number().int().min(1).max(50).catch(9).default(9),
});

@Controller()
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @Public()
  @Get('program-categories')
  categories() {
    return this.programs.categories();
  }

  @Public()
  @Get('programs')
  list(@Query(new ZodPipe(listQuery)) q: ProgramQuery) {
    return this.programs.list(q);
  }

  @Public()
  @Get('programs/:id')
  get(@Param('id') id: string) {
    return this.programs.get(id);
  }

  @Post('programs/:id/applications')
  apply(
    @CurrentUser() me: UserRow,
    @Param('id') id: string,
    @Body(new ZodPipe(apiInput(programApplySchema))) input: ProgramApplyInput,
  ) {
    return this.programs.apply(me, id, input);
  }

  @Get('me/applications')
  mine(@CurrentUser() me: UserRow) {
    return this.programs.mine(me.id);
  }

  @Get('me/applications/:id')
  mineOne(@CurrentUser() me: UserRow, @Param('id') id: string) {
    return this.programs.mineOne(me.id, id);
  }

  @Post('me/applications/:id/cancel')
  cancel(@CurrentUser() me: UserRow, @Param('id') id: string) {
    return this.programs.cancel(me.id, id);
  }
}

@Module({ controllers: [ProgramsController], providers: [ProgramsService], exports: [ProgramsService] })
export class ProgramsModule {}
