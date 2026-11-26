import { Distribution, universal, destination, settingsPatch, waveInput } from './distribution';
import { hashToken, randomToken } from '../auth/tokens';
import { PrismaService } from '../prisma/prisma.service';
import { Body, Controller, Get, Headers, Module, Param, Post, Req, Res } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Response } from 'express';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { CurrentUser, Public, RequirePermission, type AuthedRequest } from '../common/auth';
import { RedisService } from '../redis/redis.service';
import {
  channelSchema,
  digestSchema,
  flavorSchema,
  platformSchema,
  releaseRoot,
  runtimeSchema,
} from './releases';

import { ReleaseControls, controlInput, signedPart, type ControlInput } from './controls';
import { ZodPipe } from '../common/zod.pipe';
import type { User } from '@prisma/client';

@Controller()
export class UpdatesController {
  constructor(
    private readonly redis: RedisService,
    private readonly controls: ReleaseControls,
    private readonly distribution: Distribution,
    private readonly db: PrismaService,
  ) {}
  @Public()
  @Get('ota/manifest')
  async manifest(
    @Req() req: AuthedRequest,
    @Headers() headers: Record<string, string>,
    @Res() res: Response,
  ) {
    const request = z
      .object({
        'expo-platform': platformSchema,
        'x-sjyc-flavor': flavorSchema,
        'expo-channel-name': channelSchema,
        'expo-runtime-version': runtimeSchema,
      })
      .safeParse(headers);
    if (!request.success) throw new AppException('VALIDATION', '플랫폼, 채널, 런타임을 확인해 주세요.');
    const flavor = request.data['x-sjyc-flavor'],
      platform = request.data['expo-platform'],
      channel = request.data['expo-channel-name'],
      runtime = request.data['expo-runtime-version'];
    res.set({
      'expo-protocol-version': '1',
      'expo-sfv-version': '0',
      'Cache-Control': 'private, no-store',
      Vary: 'x-sjyc-flavor, expo-platform, expo-runtime-version, expo-channel-name, expo-current-update-id, expo-extra-params, cookie, eas-client-id',
    });
    const device = z.uuid().safeParse(headers['eas-client-id']);
    const group = ['ota', flavor, platform, channel, runtime].join(':');
    const rows = await this.controls.rows(group);
    const ticket = /(?:^|,\s*)sjyc_audience="([A-Za-z0-9_-]{43})"(?:,|$)/.exec(
      headers['expo-extra-params'] ?? '',
    )?.[1];
    let userId = req.user?.id;
    if (!userId && ticket) {
      const hash = await this.redis.get('ota:audience:' + hashToken(ticket));
      if (hash) {
        const session = await this.db.session.findFirst({
          where: { tokenHash: hash, expiresAt: { gt: new Date() }, user: { status: 'active' } },
          select: { userId: true },
        });
        userId = session?.userId;
      }
    }
    const update = destination(rows, await this.distribution.read(rows), userId, device.data);
    const running = headers['expo-current-update-id']?.toLowerCase();
    if (
      !update ||
      (update.kind === 'ROLLBACK' &&
        (!running || running === headers['expo-embedded-update-id']?.toLowerCase()))
    ) {
      res.status(204).end();
      return;
    }
    // 개별 식별자를 저장하지 않고 해당 업데이트를 확인한 설치 수를 근사 집계한다.
    if (device.success) {
      const hash = createHash('sha256')
        .update(update.id + device.data.toLowerCase())
        .digest('hex');
      const pipeline = this.redis
        .pipeline()
        .pfadd('ota:seen:' + update.id, hash)
        .expire('ota:seen:' + update.id, 90 * 86400);
      if (running === update.id)
        pipeline.pfadd('ota:running:' + update.id, hash).expire('ota:running:' + update.id, 90 * 86400);
      void pipeline.exec().catch(() => undefined);
    }
    if (running === update.id) {
      res.status(204).end();
      return;
    }
    const part = await signedPart(update);
    const signature = 'sig="' + part.signature + '", keyid="sjyc", alg="rsa-v1_5-sha256"';
    if (update.kind === 'ROLLBACK') {
      const boundary = 'ota-' + update.id;
      res
        .type('multipart/mixed; boundary=' + boundary)
        .send(
          Buffer.from(
            '--' +
              boundary +
              '\r\ncontent-disposition: form-data; name="directive"\r\ncontent-type: application/json\r\nexpo-signature: ' +
              signature +
              '\r\n\r\n' +
              part.body +
              '\r\n--' +
              boundary +
              '--\r\n',
          ),
        );
      return;
    }
    res
      .set({ 'Content-Type': 'application/expo+json', 'expo-signature': signature })
      .send(Buffer.from(part.body));
  }
  @Public()
  @Get('ota/assets/:hash')
  async asset(@Param('hash') hash: string, @Res() res: Response) {
    if (!digestSchema.safeParse(hash).success) throw new AppException('NOT_FOUND');
    const path = join(releaseRoot(), 'assets', hash);
    try {
      await stat(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new AppException('NOT_FOUND');
      throw e;
    }
    res.set({
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public,max-age=31536000,immutable',
    });
    await new Promise<void>((resolve, reject) => res.sendFile(path, (e) => (e ? reject(e) : resolve())));
  }
  @Public()
  @Get('ota/context')
  async context(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'private, no-store');
    const { splash } = await this.distribution.preferences();
    if (!req.session) return { splash, ticket: null };
    const ticket = randomToken();
    await this.redis.set('ota:audience:' + hashToken(ticket), hashToken(req.session.token), 'EX', 600);
    return { splash, ticket };
  }
  @RequirePermission('site.manage')
  @Get('admin/app-updates/settings')
  settings() {
    return this.distribution.preferences();
  }
  @RequirePermission('developer.access')
  @Post('admin/app-updates/settings')
  configure(
    @CurrentUser() actor: User,
    @Body(new ZodPipe(settingsPatch)) input: z.infer<typeof settingsPatch>,
  ) {
    return this.distribution.configure(actor, input);
  }
  @RequirePermission('site.manage')
  @Post('admin/app-updates/:id/waves')
  wave(
    @CurrentUser() actor: User,
    @Param('id', new ZodPipe(z.uuid())) id: string,
    @Body(new ZodPipe(waveInput)) input: z.infer<typeof waveInput>,
  ) {
    return this.distribution.change(actor, id, input);
  }
  @RequirePermission('site.manage')
  @Get('admin/app-updates')
  async list() {
    const rows = await this.controls.rows();
    const plans = await this.distribution.read(rows);
    return Promise.all(
      rows.map(async (row) => {
        const [seen, running] = await Promise.all([
          this.redis.pfcount('ota:seen:' + row.id),
          this.redis.pfcount('ota:running:' + row.id),
        ]);
        const {
          id,
          flavor,
          platform,
          channel,
          runtime,
          createdAt,
          message,
          live,
          status,
          kind,
          rolloutPercent,
          assetCount,
        } = row;
        return {
          id,
          flavor,
          platform,
          channel,
          runtime,
          createdAt,
          message,
          live,
          status,
          kind,
          rolloutPercent,
          assetCount,
          seen,
          running,
          ...this.distribution.describe(row, plans),
        };
      }),
    );
  }
  @RequirePermission('site.manage')
  @Post('admin/app-updates/:id/control')
  async change(
    @CurrentUser() actor: User,
    @Param('id', new ZodPipe(z.uuid())) id: string,
    @Body(new ZodPipe(controlInput)) input: ControlInput,
  ) {
    const rows = await this.controls.rows(),
      row = rows.find((r) => r.id === id);
    const plans = await this.distribution.read(rows);
    if (row && this.distribution.describe(row, plans).manual)
      throw new AppException('CONFLICT', '수동 발행 릴리스에서 배포 차수를 선택해 주세요.');
    return this.controls.change(actor, id, input, (r) => universal(r, plans));
  }
}
@Module({ controllers: [UpdatesController], providers: [ReleaseControls, Distribution] })
export class UpdatesModule {}
