ALTER TABLE "Lead" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "Lead"
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "leadType" TEXT NOT NULL DEFAULT 'INBOUND',
  ADD COLUMN "state" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "roomCount" INTEGER,
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "contactVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastActivityAt" TIMESTAMP(3);

CREATE INDEX "Lead_leadType_status_idx" ON "Lead"("leadType", "status");
CREATE INDEX "Lead_state_city_idx" ON "Lead"("state", "city");
CREATE INDEX "Lead_source_idx" ON "Lead"("source");
