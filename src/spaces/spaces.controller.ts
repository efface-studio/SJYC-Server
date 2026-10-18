import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
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
}

@Module({ controllers: [SpacesController], providers: [SpacesService] })
export class SpacesModule {}
