import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma/client";
import { asyncHandler } from "../../common/utils/asyncHandler";

const listSchema = z.object({
  query: z.string().min(1).max(60),
});

export const listTenants = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listSchema.safeParse({ query: String(req.query.query || "") });
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: "INVALID_QUERY", message: "Provide query param: ?query=..." },
    });
  }

  const q = parsed.data.query.trim();

  const tenants = await prisma.tenant.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
    },
    take: 10,
    orderBy: { name: "asc" },
  });

  res.json({ tenants });
});

const slugSchema = z.object({
  slug: z.string().min(2).max(60),
});

export const getTenantBySlug = asyncHandler(async (req: Request, res: Response) => {
  const parsed = slugSchema.safeParse({ slug: req.params.slug });
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: "INVALID_SLUG", message: "Invalid tenant slug" },
    });
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug: parsed.data.slug, status: "ACTIVE" },
    select: { id: true, name: true, slug: true },
  });

  if (!tenant) {
    return res.status(404).json({
      error: { code: "TENANT_NOT_FOUND", message: "Tenant not found" },
    });
  }

  res.json({ tenant });
});
