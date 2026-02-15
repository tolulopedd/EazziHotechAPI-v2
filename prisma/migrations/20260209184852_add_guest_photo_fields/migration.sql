-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "guestPhotoKey" TEXT,
ADD COLUMN     "guestPhotoMime" TEXT,
ADD COLUMN     "guestPhotoSize" INTEGER,
ADD COLUMN     "guestPhotoUpdatedAt" TIMESTAMP(3);
