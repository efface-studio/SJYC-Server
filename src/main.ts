import { createApp } from './bootstrap';
import { logger } from './common/logger';
import { env } from './config/env';

async function main() {
  const app = await createApp();
  await app.listen(env().PORT);
  logger.info(`API listening on :${env().PORT}`);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'API 기동 실패');
  process.exit(1);
});
