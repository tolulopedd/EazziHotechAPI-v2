/*
  Warnings:

  - The `status` column on the `Booking` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MANUAL', 'PAYSTACK', 'STRIPE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BookingPaymentStatus" AS ENUM ('UNPAID', 'PARTPAID', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BookingStayStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CheckEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "VerificationMode" AS ENUM ('MANUAL_REVIEW', 'FACE_MATCH');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "guestPhone" TEXT,
ADD COLUMN     "paymentStatus" "BookingPaymentStatus" NOT NULL DEFAULT 'UNPAID',
DROP COLUMN "status",
ADD COLUMN     "status" "BookingStayStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'MANUAL',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "reference" TEXT,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "CheckEventType" NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedByUserId" TEXT,
    "photoUrl" TEXT,
    "idDocUrl" TEXT,
    "verificationMode" "VerificationMode" NOT NULL DEFAULT 'MANUAL_REVIEW',
    "verificationResult" "VerificationResult" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "CheckEvent_tenantId_idx" ON "CheckEvent"("tenantId");

-- CreateIndex
CREATE INDEX "CheckEvent_bookingId_idx" ON "CheckEvent"("bookingId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckEvent" ADD CONSTRAINT "CheckEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckEvent" ADD CONSTRAINT "CheckEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
