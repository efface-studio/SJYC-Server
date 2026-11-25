import { Body, Controller, Get, Headers, Module, Param, Post, Res } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Response } from 'express';
import { z } from 'zod';
import { AppException } from '../common/app-exception';
import { CurrentUser, Public, RequirePermission } from '../common/auth';
import { RedisService } from '../redis/redis.service';
import {
  channelSchema,
  digestSchema,
  flavorSchema,
  platformSchema,
  releaseRoot,
  runtimeSchema,
} from './releases';

import { ReleaseControls, controlInput, inRollout, signedPart, type ControlInput } from './controls';
import { ZodPipe } from '../common/zod.pipe';
import type { User } from '@prisma/client';

@Controller()
export class UpdatesController {
  constructor(
    private readonly redis: RedisService,
    private readonly controls: ReleaseControls,
  ) {}
  @Public()
  @Get('ota/manifest')
  async manifest(@Headers() headers: Record<string, string>, @Res() res: Response) {
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
      Vary: 'x-sjyc-flavor, expo-platform, expo-runtime-version, expo-channel-name, expo-current-update-id',
    });
    const device = z.uuid().safeParse(headers['eas-client-id']);
    const group = ['ota', flavor, platform, channel, runtime].join(':');
    const rows = await this.controls.rows(group);
    const update = rows.find(
      (row) => row.status === 'ACTIVE' && inRollout(row.id, row.rolloutPercent, device.data),
    );
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
  @RequirePermission('site.manage')
  @Get('admin/app-updates')
  async list() {
    const rows = await this.controls.rows();
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
        };
      }),
    );
  }
  @RequirePermission('site.manage')
  @Post('admin/app-updates/:id/control')
  change(
    @CurrentUser() actor: User,
    @Param('id', new ZodPipe(z.uuid())) id: string,
    @Body(new ZodPipe(controlInput)) input: ControlInput,
  ) {
    return this.controls.change(actor, id, input);
  }
}
@Module({ controllers: [UpdatesController], providers: [ReleaseControls] })
export class UpdatesModule {}
