-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('ROOM', 'DAMAGE', 'EXTRA', 'PENALTY', 'DISCOUNT');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('OPEN', 'VOID');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "guestId" TEXT;

-- CreateTable
CREATE TABLE "BookingCharge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "ChargeType" NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "ChargeStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "nationality" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "idIssuedBy" TEXT,
    "vehiclePlate" TEXT,
    "photoKey" TEXT,
    "photoMime" TEXT,
    "photoSize" INTEGER,
    "photoUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingCharge_tenantId_idx" ON "BookingCharge"("tenantId");

-- CreateIndex
CREATE INDEX "BookingCharge_bookingId_idx" ON "BookingCharge"("bookingId");

-- CreateIndex
CREATE INDEX "BookingCharge_bookingId_type_idx" ON "BookingCharge"("bookingId", "type");

-- CreateIndex
CREATE INDEX "Guest_tenantId_idx" ON "Guest"("tenantId");

-- CreateIndex
CREATE INDEX "Guest_tenantId_phone_idx" ON "Guest"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "Guest_tenantId_email_idx" ON "Guest"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Guest_tenantId_idNumber_idx" ON "Guest"("tenantId", "idNumber");

-- CreateIndex
CREATE INDEX "Booking_tenantId_guestId_idx" ON "Booking"("tenantId", "guestId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCharge" ADD CONSTRAINT "BookingCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCharge" ADD CONSTRAINT "BookingCharge_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
