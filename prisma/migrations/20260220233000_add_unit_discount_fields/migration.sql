-- CreateEnum
CREATE TYPE "UnitDiscountType" AS ENUM ('PERCENT', 'FIXED_PRICE');

-- AlterTable
ALTER TABLE "Unit"
  ADD COLUMN "discountType" "UnitDiscountType",
  ADD COLUMN "discountValue" DECIMAL(12,2),
  ADD COLUMN "discountStart" TIMESTAMP(3),
  ADD COLUMN "discountEnd" TIMESTAMP(3),
  ADD COLUMN "discountLabel" TEXT;
