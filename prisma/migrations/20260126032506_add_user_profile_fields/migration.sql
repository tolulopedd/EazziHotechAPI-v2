-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "totalAmount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "phone" TEXT;
