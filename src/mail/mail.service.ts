import { Global, Injectable, Module } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProd } from '../config/env';
import { AppException } from '../common/app-exception';
import { logger } from '../common/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** 계정 유무를 조회하거나 토큰을 발급하기 전에 발송 가능 여부를 검사한다. */
export function requireMailDelivery(): void {
  const config = env();
  if (config.MAIL_DELIVERY === 'disabled' || (config.SIGNUP_PREVIEW_CODE === 'on' && !config.SMTP_URL)) {
    throw new AppException('NOT_CONFIGURED', '현재 이메일을 발송할 수 없습니다.');
  }
}

/** 안내 메일 (이메일 인증·비밀번호 재설정). 로컬은 Mailpit, 테스트는 메일 더블로 교체한다 */
@Injectable()
export class MailService {
  private readonly transport: Transporter | null =
    env().MAIL_DELIVERY === 'smtp' && env().SMTP_URL ? nodemailer.createTransport(env().SMTP_URL) : null;

  async send(msg: MailMessage): Promise<void> {
    requireMailDelivery();
    if (!this.transport) {
      // 개발 편의: SMTP 가 없으면 로그로 남긴다 (운영은 기동 시 SMTP_URL 을 요구한다)
      logger.warn({ to: msg.to, subject: msg.subject }, 'SMTP_URL 이 없어 메일을 보내지 않았습니다');
      if (!isProd()) logger.info(msg.text);
      return;
    }
    await this.transport.sendMail({ from: env().MAIL_FROM, ...msg });
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
