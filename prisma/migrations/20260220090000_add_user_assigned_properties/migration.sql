-- Add per-user property assignment scope for MANAGER/STAFF access control
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "assignedPropertyIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "User"
SET "assignedPropertyIds" = ARRAY[]::TEXT[]
WHERE "assignedPropertyIds" IS NULL;

ALTER TABLE "User"
ALTER COLUMN "assignedPropertyIds" SET NOT NULL;
