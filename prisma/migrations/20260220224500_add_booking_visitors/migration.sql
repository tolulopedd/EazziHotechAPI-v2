-- CreateTable
CREATE TABLE "BookingVisitor" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "phone" TEXT,
  "idType" TEXT,
  "idNumber" TEXT,
  "purpose" TEXT,
  "isOvernight" BOOLEAN NOT NULL DEFAULT false,
  "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkOutAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BookingVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingVisitor_tenantId_idx" ON "BookingVisitor"("tenantId");

-- CreateIndex
CREATE INDEX "BookingVisitor_bookingId_idx" ON "BookingVisitor"("bookingId");

-- CreateIndex
CREATE INDEX "BookingVisitor_tenantId_bookingId_checkOutAt_idx" ON "BookingVisitor"("tenantId", "bookingId", "checkOutAt");

-- AddForeignKey
ALTER TABLE "BookingVisitor" ADD CONSTRAINT "BookingVisitor_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingVisitor" ADD CONSTRAINT "BookingVisitor_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
