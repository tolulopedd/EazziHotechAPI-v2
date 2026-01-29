-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "maxProperties" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "maxUnits" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "maxUsers" INTEGER NOT NULL DEFAULT 10;

-- CreateIndex
CREATE INDEX "Tenant_slug_idx" ON "Tenant"("slug");
