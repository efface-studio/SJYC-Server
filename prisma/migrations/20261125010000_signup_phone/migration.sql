ALTER TABLE "User" ADD COLUMN "signupPhoneVerifiedAt" TIMESTAMP(3);
CREATE TABLE "SignupPhoneChallenge" (
  "scope" TEXT PRIMARY KEY,
  "ticketHash" TEXT NOT NULL UNIQUE,
  "data" JSONB NOT NULL,
  "phone" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "codeExpiresAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SignupPhoneChallenge_expiresAt_idx" ON "SignupPhoneChallenge"("expiresAt");
