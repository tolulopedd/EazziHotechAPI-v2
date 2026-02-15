-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "earlyCheckout" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "earlyCheckoutAt" TIMESTAMP(3),
ADD COLUMN     "refundAmount" DECIMAL(12,2),
ADD COLUMN     "refundApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refundEligibleAmount" DECIMAL(12,2),
ADD COLUMN     "refundPolicy" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundStatus" TEXT;

-- AlterTable
ALTER TABLE "CheckEvent" ADD COLUMN     "earlyCheckout" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refundAmount" DECIMAL(12,2),
ADD COLUMN     "refundApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refundEligibleAmount" DECIMAL(12,2),
ADD COLUMN     "refundPolicy" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundStatus" TEXT;
