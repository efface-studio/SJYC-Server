import { OpenActivity } from '../common/auth';
import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import type { User as UserRow } from '@prisma/client';
import { CurrentUser, Public } from '../common/auth';
import { apiInput, ZodPipe } from '../common/zod.pipe';
import { type ClubApplyInput, clubApplySchema } from '../shared/domain/schemas';
import { ClubsService } from './clubs.service';

@Controller()
export class ClubsController {
  constructor(private readonly clubs: ClubsService) {}

  @Public()
  @Get('clubs')
  list() {
    return this.clubs.list();
  }

  @Public()
  @Get('clubs/:id')
  get(@Param('id') id: string) {
    return this.clubs.get(id);
  }

  @Get('clubs/:id/members')
  members(@CurrentUser() me: UserRow, @Param('id') id: string) {
    return this.clubs.members(id, me.id);
  }

  @Get('clubs/:id/posts')
  posts(@CurrentUser() me: UserRow, @Param('id') id: string) {
    return this.clubs.posts(id, me.id);
  }

  @OpenActivity('clubs')
  @Post('clubs/:id/applications')
  apply(
    @CurrentUser() me: UserRow,
    @Param('id') id: string,
    @Body(new ZodPipe(apiInput(clubApplySchema))) input: ClubApplyInput,
  ) {
    return this.clubs.apply(me, id, input);
  }

  @Get('me/clubs')
  mine(@CurrentUser() me: UserRow) {
    return this.clubs.mine(me.id);
  }

  @Get('me/club-applications')
  myApplications(@CurrentUser() me: UserRow) {
    return this.clubs.myApplications(me.id);
  }
}

@Module({ controllers: [ClubsController], providers: [ClubsService], exports: [ClubsService] })
export class ClubsModule {}
