-- CreateTable
CREATE TABLE "ClubManager" (
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubManager_pkey" PRIMARY KEY ("clubId","userId")
);

-- CreateIndex
CREATE INDEX "ClubManager_userId_idx" ON "ClubManager"("userId");

-- AddForeignKey
ALTER TABLE "ClubManager" ADD CONSTRAINT "ClubManager_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubManager" ADD CONSTRAINT "ClubManager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
