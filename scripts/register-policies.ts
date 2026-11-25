import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createSeed } from '../src/shared/mock/seed';

const prisma = new PrismaClient();

async function register() {
  const effectiveAt = new Date();
  const originals = createSeed().policies;
  const documents = await Promise.all(
    originals.map(async (doc) => ({
      ...doc,
      text: (await readFile(join(__dirname, '..', 'policies', doc.key + '.txt'), 'utf8')).trim(),
    })),
  );
  await prisma.$transaction(async (tx) => {
    for (const doc of documents) {
      // 개인정보 처리방침은 실제 수탁자·보유 일정과 아동 동의 절차를 확인한 뒤 관리자에서 게시한다.
      const confirmed = doc.key !== 'privacy';
      const data = {
        title: doc.title,
        body: doc.text,
        confirmed,
        effectiveAt: confirmed ? effectiveAt : null,
      };
      const current = await tx.policy.findUnique({ where: { key: doc.key } });
      if (current) {
        if (current.confirmed || current.body !== doc.body) continue;
        const result = await tx.policy.updateMany({
          where: { key: doc.key, confirmed: false, body: doc.body, updatedAt: current.updatedAt },
          data,
        });
        if (!result.count) continue;
      } else {
        await tx.policy.create({ data: { key: doc.key, ...data } });
      }
      await tx.auditEvent.create({
        data: {
          actorName: '정책 문서 등록',
          action: 'policy.update',
          targetType: 'policy',
          targetId: doc.key,
          summary: doc.title + (confirmed ? ' 게시' : ' 검토본 등록'),
        },
      });
      process.stdout.write(doc.key + (confirmed ? ' 게시' : ' 검토본 등록') + '\n');
    }
  });
}
register()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.name : '정책 등록 실패');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
