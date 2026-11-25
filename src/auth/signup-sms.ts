import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { AppException } from '../common/app-exception';
import { env } from '../config/env';

@Injectable()
export class SignupSms {
  async send(phone: string, code: string) {
    const config = env();
    if (config.SIGNUP_PREVIEW_CODE === 'on') return;
    const { SOLAPI_API_KEY: apiKey, SOLAPI_API_SECRET: secret, SOLAPI_SENDER: from } = config;
    if (!apiKey || !secret || !from)
      throw new AppException('NOT_CONFIGURED', '문자 발송 설정을 확인 중입니다. 잠시 후 다시 시도해 주세요.');
    const date = new Date().toISOString(),
      salt = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', secret)
      .update(date + salt)
      .digest('hex');
    try {
      const res = await fetch('https://api.solapi.com/messages/v4/send-many/fast', {
        method: 'POST',
        signal: AbortSignal.timeout(4000),
        headers: {
          Authorization:
            'HMAC-SHA256 apiKey=' + apiKey + ', date=' + date + ', salt=' + salt + ', signature=' + signature,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              type: 'SMS',
              to: phone.replace(/-/g, ''),
              from: from.replace(/-/g, ''),
              text: '[중구청소년센터] 인증번호 ' + code + ' (5분 이내 입력)',
            },
          ],
        }),
      });
      if (!res.ok) throw Error();
      const result = z
        .object({
          groupInfo: z.object({
            groupId: z.string(),
            count: z.object({ registeredFailed: z.number().optional() }).optional(),
          }),
          failedMessageList: z.array(z.unknown()).optional(),
        })
        .parse(await res.json());
      if (
        !result.groupInfo?.groupId ||
        result.failedMessageList?.length ||
        result.groupInfo.count?.registeredFailed
      )
        throw Error();
    } catch {
      throw new AppException('NETWORK', '인증 문자를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
}
