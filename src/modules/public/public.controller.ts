import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma/client";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { randomUUID } from "crypto";

const LEAD_RATE_WINDOW_MS = 15 * 60 * 1000;
const LEAD_RATE_MAX = 5;
const leadSubmissionsByIp = new Map<string, number[]>();

function getClientIp(req: Request) {
  const xff = req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || req.ip || "unknown";
  return req.ip || "unknown";
}

function isRateLimited(ip: string) {
  const now = Date.now();
  const cutoff = now - LEAD_RATE_WINDOW_MS;
  const records = (leadSubmissionsByIp.get(ip) || []).filter((ts) => ts >= cutoff);
  if (records.length >= LEAD_RATE_MAX) {
    leadSubmissionsByIp.set(ip, records);
    return true;
  }
  records.push(now);
  leadSubmissionsByIp.set(ip, records);
  return false;
}

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

const recentSchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const listRecentTenants = asyncHandler(async (req: Request, res: Response) => {
  const parsed = recentSchema.safeParse({ limit: req.query.limit });
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: "INVALID_LIMIT", message: "Invalid limit value" },
    });
  }

  const tenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: parsed.data.limit,
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

const leadSchema = z.object({
  companyName: z.string().min(2).max(120),
  contactName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).max(40).optional(),
  businessType: z.string().min(2).max(80).optional(),
  message: z.string().max(1000).optional(),
  website: z.string().max(200).optional(), // honeypot: should stay empty
});

export const createLead = asyncHandler(async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: { code: "RATE_LIMITED", message: "Too many lead submissions. Please try again later." },
    });
  }

  const parsed = leadSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid lead payload" },
    });
  }

  // Honeypot trap for simple bots.
  if ((parsed.data.website || "").trim()) {
    return res.status(201).json({ leadId: randomUUID(), message: "Lead received. Our team will contact you shortly." });
  }

  const leadId = randomUUID();
  const now = new Date().toISOString();
  const lead = {
    id: leadId,
    createdAt: now,
    companyName: parsed.data.companyName,
    contactName: parsed.data.contactName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    businessType: parsed.data.businessType,
    message: parsed.data.message,
    source: "landing-page",
    ip,
  };

  await prisma.lead.create({
    data: {
      id: leadId,
      companyName: lead.companyName,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      businessType: lead.businessType,
      message: lead.message,
      source: lead.source,
      ip: lead.ip,
    },
  });

  // Phase 2: capture lead payload for sales follow-up.
  // Persist to external CRM/webhook in production if LEADS_WEBHOOK_URL is set.
  if (process.env.LEADS_WEBHOOK_URL) {
    try {
      await fetch(process.env.LEADS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });
    } catch {
      // keep request successful; sales can still collect from server logs for fallback.
    }
  }

  console.info("[public-lead]", lead);
  res.status(201).json({ leadId, message: "Lead received. Our team will contact you shortly." });
});
