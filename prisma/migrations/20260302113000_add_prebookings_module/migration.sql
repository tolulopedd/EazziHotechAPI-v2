-- CreateEnum
CREATE TYPE "PreBookingStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'CONVERTED');

-- CreateTable
CREATE TABLE "PreBooking" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "plannedCheckIn" TIMESTAMP(3),
    "plannedCheckOut" TIMESTAMP(3),
    "amountPaid" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PreBookingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "convertedBookingId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PreBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreBooking_convertedBookingId_key" ON "PreBooking"("convertedBookingId");

-- CreateIndex
CREATE INDEX "PreBooking_tenantId_idx" ON "PreBooking"("tenantId");

-- CreateIndex
CREATE INDEX "PreBooking_guestId_idx" ON "PreBooking"("guestId");

-- CreateIndex
CREATE INDEX "PreBooking_tenantId_status_idx" ON "PreBooking"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "PreBooking" ADD CONSTRAINT "PreBooking_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreBooking" ADD CONSTRAINT "PreBooking_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreBooking" ADD CONSTRAINT "PreBooking_convertedBookingId_fkey" FOREIGN KEY ("convertedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
