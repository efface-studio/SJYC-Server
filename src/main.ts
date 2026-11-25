import { createApp } from './bootstrap';
import { logger } from './common/logger';
import { env } from './config/env';

async function main() {
  const app = await createApp();
  const { PORT, LISTEN_HOST, SIGNUP_PREVIEW_CODE } = env();
  const host = SIGNUP_PREVIEW_CODE === 'on' ? '127.0.0.1' : LISTEN_HOST;
  if (host) await app.listen(PORT, host);
  else await app.listen(PORT);
  logger.info(`API listening on :${env().PORT}`);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'API 기동 실패');
  process.exit(1);
});
