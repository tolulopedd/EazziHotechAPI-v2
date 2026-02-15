-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "Tenant"
ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "currentPeriodEndAt" TIMESTAMP(3),
ADD COLUMN "graceEndsAt" TIMESTAMP(3),
ADD COLUMN "lastReminderSentAt" TIMESTAMP(3),
ADD COLUMN "lastSuspensionNoticeAt" TIMESTAMP(3),
ADD COLUMN "lastReactivationNoticeAt" TIMESTAMP(3);
