-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('draft', 'published', 'hidden');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('submitted', 'approved', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "ProgramCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProgramCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "recruitStartsAt" TIMESTAMP(3) NOT NULL,
    "recruitEndsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "cancelDeadline" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramApplication" (
    "id" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'submitted',
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Program_status_recruitEndsAt_idx" ON "Program"("status", "recruitEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramApplication_receiptNo_key" ON "ProgramApplication"("receiptNo");

-- CreateIndex
CREATE INDEX "ProgramApplication_programId_status_idx" ON "ProgramApplication"("programId", "status");

-- CreateIndex
CREATE INDEX "ProgramApplication_userId_createdAt_idx" ON "ProgramApplication"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProgramCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramApplication" ADD CONSTRAINT "ProgramApplication_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramApplication" ADD CONSTRAINT "ProgramApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 접수 번호 일련번호 (서버가 발급, SJYC-연도-000001)
CREATE SEQUENCE "program_application_receipt_seq";

-- 한 회원은 한 프로그램에 활동 중(접수·승인) 신청을 1건만 가진다 — 동시 요청 중복 방지
CREATE UNIQUE INDEX "ProgramApplication_active_unique"
  ON "ProgramApplication" ("programId", "userId")
  WHERE "status" IN ('submitted', 'approved');
