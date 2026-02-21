-- Create enums for platform news content
DO $$ BEGIN
  CREATE TYPE "NewsType" AS ENUM ('ARTICLE', 'VIDEO', 'FEATURE', 'ANNOUNCEMENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NewsStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create table for admin-managed public newsroom content
CREATE TABLE IF NOT EXISTS "NewsItem" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "type" "NewsType" NOT NULL DEFAULT 'ARTICLE',
  "status" "NewsStatus" NOT NULL DEFAULT 'DRAFT',
  "excerpt" TEXT NOT NULL,
  "content" TEXT,
  "externalUrl" TEXT,
  "videoUrl" TEXT,
  "thumbnailUrl" TEXT,
  "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NewsItem_slug_key" ON "NewsItem"("slug");
CREATE INDEX IF NOT EXISTS "NewsItem_status_publishedAt_idx" ON "NewsItem"("status", "publishedAt");
CREATE INDEX IF NOT EXISTS "NewsItem_type_publishedAt_idx" ON "NewsItem"("type", "publishedAt");
CREATE INDEX IF NOT EXISTS "NewsItem_isFeatured_publishedAt_idx" ON "NewsItem"("isFeatured", "publishedAt");
