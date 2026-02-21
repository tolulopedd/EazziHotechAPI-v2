import type { Request, Response } from "express";
import type { NewsStatus, NewsType } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { isSuperAdminEmail } from "../../common/auth/superadmin";

type Role = "ADMIN" | "MANAGER" | "STAFF";
type JwtUser = { userId: string; tenantId: string; role: Role };

const allowedTypes = new Set<NewsType>(["ARTICLE", "VIDEO", "FEATURE", "ANNOUNCEMENT"]);
const allowedStatuses = new Set<NewsStatus>(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const defaultNewsSeeds: Array<{
  title: string;
  slug: string;
  type: NewsType;
  status: NewsStatus;
  excerpt: string;
  content?: string | null;
  externalUrl?: string | null;
  videoUrl?: string | null;
  isFeatured?: boolean;
}> = [
  {
    title: "How EazziHotech reduces front-desk friction from booking to check-out",
    slug: "front-desk-friction-reduction",
    type: "ARTICLE",
    status: "PUBLISHED",
    excerpt:
      "A practical walkthrough of booking, payment, check-in, in-house, and check-out workflows for daily operations.",
    content:
      "From reservation to checkout, EazziHotech gives hospitality teams one operational flow for guest records, payment status, check-in verification, in-house visibility, and settlement at checkout.",
    externalUrl: null,
    isFeatured: true,
  },
  {
    title: "Product Demo: End-to-end booking to check-out",
    slug: "product-demo-end-to-end-booking-to-checkout",
    type: "VIDEO",
    status: "PUBLISHED",
    excerpt: "See the complete operations flow in one guided walkthrough.",
    videoUrl: "https://www.youtube.com/@eazzihotech",
    isFeatured: false,
  },
];

function toSafeNews(row: any) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    type: row.type,
    status: row.status,
    excerpt: row.excerpt,
    content: row.content,
    externalUrl: row.externalUrl,
    videoUrl: row.videoUrl,
    thumbnailUrl: row.thumbnailUrl,
    isFeatured: row.isFeatured,
    publishedAt: row.publishedAt,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getActor(req: Request): JwtUser {
  const user = (req as any).user as JwtUser | undefined;
  if (!user) throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  return user;
}

function normalize(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function allowedNewsTenantSlugs() {
  const fromEnv = (process.env.NEWS_CONTROL_TENANT_SLUGS || "")
    .split(",")
    .map((x) => normalize(x))
    .filter(Boolean);

  // Default to founding tenant
  if (fromEnv.length === 0) return new Set(["dtt-shortlet"]);
  return new Set(fromEnv);
}

async function requireNewsControlAccess(req: Request) {
  const actor = getActor(req);
  const actorUser = await prisma.user.findFirst({
    where: { id: actor.userId, tenantId: actor.tenantId },
    select: { email: true, role: true, tenantId: true },
  });
  if (!actorUser) throw new AppError("Authentication required", 401, "UNAUTHORIZED");

  if (isSuperAdminEmail(actorUser.email)) return;

  if (actorUser.role !== "ADMIN") {
    throw new AppError("News admin access required", 403, "NEWS_ADMIN_REQUIRED");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: actorUser.tenantId },
    select: { slug: true },
  });
  const slug = normalize(tenant?.slug);
  if (!allowedNewsTenantSlugs().has(slug)) {
    throw new AppError("News admin access required", 403, "NEWS_ADMIN_REQUIRED");
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function cleanOptionalString(value: unknown) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function validateType(value: unknown) {
  if (value === undefined) return undefined;
  const t = String(value).toUpperCase() as NewsType;
  if (!allowedTypes.has(t)) throw new AppError("Invalid news type", 400, "VALIDATION_ERROR");
  return t;
}

function validateStatus(value: unknown) {
  if (value === undefined) return undefined;
  const s = String(value).toUpperCase() as NewsStatus;
  if (!allowedStatuses.has(s)) throw new AppError("Invalid news status", 400, "VALIDATION_ERROR");
  return s;
}

export const listNewsAdmin = asyncHandler(async (req: Request, res: Response) => {
  await requireNewsControlAccess(req);

  const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
  const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || "20"), 10), 1), 100);
  const skip = (page - 1) * pageSize;
  const search = String(req.query.search || "").trim();
  const type = validateType(req.query.type);
  const status = validateStatus(req.query.status);

  const where: any = {
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { excerpt: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.newsItem.count({ where }),
    prisma.newsItem.findMany({
      where,
      orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
    }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    news: rows.map(toSafeNews),
  });
});

export const createNews = asyncHandler(async (req: Request, res: Response) => {
  await requireNewsControlAccess(req);
  const actor = getActor(req);
  const title = String(req.body?.title || "").trim();
  const excerpt = String(req.body?.excerpt || "").trim();
  const type = validateType(req.body?.type) || "ARTICLE";
  const status = validateStatus(req.body?.status) || "DRAFT";
  const content = cleanOptionalString(req.body?.content);
  const externalUrl = cleanOptionalString(req.body?.externalUrl);
  const videoUrl = cleanOptionalString(req.body?.videoUrl);
  const thumbnailUrl = cleanOptionalString(req.body?.thumbnailUrl);
  const isFeatured = Boolean(req.body?.isFeatured);

  if (!title) throw new AppError("Title is required", 400, "VALIDATION_ERROR");
  if (!excerpt) throw new AppError("Excerpt is required", 400, "VALIDATION_ERROR");

  const providedSlug = cleanOptionalString(req.body?.slug);
  const slug = slugify(providedSlug || title);
  if (!slug) throw new AppError("A valid slug is required", 400, "VALIDATION_ERROR");

  const existing = await prisma.newsItem.findUnique({ where: { slug }, select: { id: true } });
  if (existing) throw new AppError("Slug already exists", 409, "CONFLICT");

  const row = await prisma.newsItem.create({
    data: {
      title,
      slug,
      type,
      status,
      excerpt,
      content,
      externalUrl,
      videoUrl,
      thumbnailUrl,
      isFeatured,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
    },
  });

  res.status(201).json({ news: toSafeNews(row) });
});

export const updateNews = asyncHandler(async (req: Request, res: Response) => {
  await requireNewsControlAccess(req);
  const actor = getActor(req);
  const id = String(req.params.id || "").trim();
  if (!id) throw new AppError("News id is required", 400, "VALIDATION_ERROR");

  const existing = await prisma.newsItem.findUnique({
    where: { id },
    select: { id: true, status: true, slug: true, publishedAt: true },
  });
  if (!existing) throw new AppError("News item not found", 404, "NOT_FOUND");

  const nextTitle = req.body?.title !== undefined ? String(req.body.title).trim() : undefined;
  const nextExcerpt = req.body?.excerpt !== undefined ? String(req.body.excerpt).trim() : undefined;
  const nextType = validateType(req.body?.type);
  const nextStatus = validateStatus(req.body?.status);

  const nextSlugRaw = req.body?.slug !== undefined ? cleanOptionalString(req.body.slug) : undefined;
  const nextSlug = nextSlugRaw !== undefined ? slugify(nextSlugRaw || nextTitle || existing.slug) : undefined;

  if (nextTitle !== undefined && !nextTitle) throw new AppError("Title is required", 400, "VALIDATION_ERROR");
  if (nextExcerpt !== undefined && !nextExcerpt) throw new AppError("Excerpt is required", 400, "VALIDATION_ERROR");
  if (nextSlug !== undefined && !nextSlug) throw new AppError("A valid slug is required", 400, "VALIDATION_ERROR");

  if (nextSlug && nextSlug !== existing.slug) {
    const conflict = await prisma.newsItem.findUnique({ where: { slug: nextSlug }, select: { id: true } });
    if (conflict && conflict.id !== id) throw new AppError("Slug already exists", 409, "CONFLICT");
  }

  const row = await prisma.newsItem.update({
    where: { id },
    data: {
      ...(nextTitle !== undefined ? { title: nextTitle } : {}),
      ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
      ...(nextType !== undefined ? { type: nextType } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
      ...(nextExcerpt !== undefined ? { excerpt: nextExcerpt } : {}),
      ...(req.body?.content !== undefined ? { content: cleanOptionalString(req.body.content) } : {}),
      ...(req.body?.externalUrl !== undefined ? { externalUrl: cleanOptionalString(req.body.externalUrl) } : {}),
      ...(req.body?.videoUrl !== undefined ? { videoUrl: cleanOptionalString(req.body.videoUrl) } : {}),
      ...(req.body?.thumbnailUrl !== undefined ? { thumbnailUrl: cleanOptionalString(req.body.thumbnailUrl) } : {}),
      ...(req.body?.isFeatured !== undefined ? { isFeatured: Boolean(req.body.isFeatured) } : {}),
      ...(nextStatus === "PUBLISHED" && existing.status !== "PUBLISHED" ? { publishedAt: new Date() } : {}),
      ...(nextStatus === "DRAFT" ? { publishedAt: null } : {}),
      updatedByUserId: actor.userId,
    },
  });

  res.json({ news: toSafeNews(row) });
});

export const deleteNews = asyncHandler(async (req: Request, res: Response) => {
  await requireNewsControlAccess(req);
  const id = String(req.params.id || "").trim();
  if (!id) throw new AppError("News id is required", 400, "VALIDATION_ERROR");

  await prisma.newsItem.delete({ where: { id } });
  res.json({ ok: true });
});

export const importDefaultNews = asyncHandler(async (req: Request, res: Response) => {
  await requireNewsControlAccess(req);
  const actor = getActor(req);

  const existing = await prisma.newsItem.findMany({
    where: { slug: { in: defaultNewsSeeds.map((x) => x.slug) } },
    select: { slug: true },
  });
  const existingSlugs = new Set(existing.map((x) => x.slug));

  const toCreate = defaultNewsSeeds.filter((x) => !existingSlugs.has(x.slug));
  if (toCreate.length === 0) {
    return res.json({ created: 0, skipped: defaultNewsSeeds.length, total: defaultNewsSeeds.length });
  }

  await prisma.newsItem.createMany({
    data: toCreate.map((x) => ({
      title: x.title,
      slug: x.slug,
      type: x.type,
      status: x.status,
      excerpt: x.excerpt,
      content: x.content || null,
      externalUrl: x.externalUrl || null,
      videoUrl: x.videoUrl || null,
      isFeatured: Boolean(x.isFeatured),
      publishedAt: x.status === "PUBLISHED" ? new Date() : null,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
    })),
    skipDuplicates: true,
  });

  res.json({
    created: toCreate.length,
    skipped: defaultNewsSeeds.length - toCreate.length,
    total: defaultNewsSeeds.length,
  });
});
