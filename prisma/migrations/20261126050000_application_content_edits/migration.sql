BEGIN;
ALTER TABLE "ProgramApplication" ADD COLUMN "contentEdits" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ClubApplication" ADD COLUMN "contentEdits" JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
