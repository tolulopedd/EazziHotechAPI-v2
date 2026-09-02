import type { NextFunction, Request, Response } from "express";
import type { LeadStatus } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { isSuperAdminEmail } from "../../common/auth/superadmin";
import { hotelsNgProspects } from "./hotels-ng-prospects";
import { buildLeadIntroductionEmail, isResendEmailConfigured, sendLeadIntroductionEmail } from "../../common/notifications/email";

type Role = "ADMIN" | "MANAGER" | "STAFF";
type JwtUser = { userId: string; tenantId: string; role: Role };
type LeadType = "INBOUND" | "OUTBOUND";
type VerificationStatus = "NOT_REQUIRED" | "PENDING" | "VERIFIED";

const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const;
const LEAD_TYPES = ["INBOUND", "OUTBOUND"] as const;
const VERIFICATION_STATUSES = ["NOT_REQUIRED", "PENDING", "VERIFIED"] as const;

function getActor(req: Request): JwtUser {
  const u = (req as any).user as JwtUser | undefined;
  if (!u) throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  return u;
}

async function requireSuperAdmin(req: Request) {
  const actor = getActor(req);
  const actorUser = await prisma.user.findFirst({
    where: { id: actor.userId, tenantId: actor.tenantId },
    select: { email: true },
  });
  if (!actorUser) throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  if (!isSuperAdminEmail(actorUser.email)) {
    throw new AppError("Super admin access required", 403, "SUPERADMIN_REQUIRED");
  }
}

function safeLead(l: any) {
  return {
    id: l.id,
    companyName: l.companyName,
    contactName: l.contactName,
    email: l.email,
    phone: l.phone,
    businessType: l.businessType,
    message: l.message,
    source: l.source,
    sourceUrl: l.sourceUrl,
    contactSourceUrl: l.contactSourceUrl,
    leadType: l.leadType,
    state: l.state,
    city: l.city,
    address: l.address,
    roomCount: l.roomCount,
    verificationStatus: l.verificationStatus,
    contactVerifiedAt: l.contactVerifiedAt,
    lastActivityAt: l.lastActivityAt,
    introEmailSentAt: l.introEmailSentAt,
    introEmailSubject: l.introEmailSubject,
    ip: l.ip,
    status: l.status,
    assignedTo: l.assignedTo,
    notes: l.notes,
    contactedAt: l.contactedAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

function asOptionalString(value: unknown, max = 500) {
  if (value === undefined) return undefined;
  const next = String(value ?? "").trim();
  if (next.length > max) throw new AppError(`Value must be ${max} characters or less`, 400, "VALIDATION_ERROR");
  return next || null;
}

function asOptionalEmail(value: unknown) {
  const next = asOptionalString(value, 254);
  if (next === undefined || next === null) return next;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
    throw new AppError("Email must be valid", 400, "VALIDATION_ERROR");
  }
  return next.toLowerCase();
}

function asOptionalRoomCount(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 100_000) {
    throw new AppError("Room count must be a whole number", 400, "VALIDATION_ERROR");
  }
  return count;
}

function asEnum<T extends readonly string[]>(value: unknown, allowed: T, field: string) {
  const next = String(value ?? "").trim().toUpperCase();
  if (!allowed.includes(next)) throw new AppError(`Invalid ${field}`, 400, "VALIDATION_ERROR");
  return next as T[number];
}

function normalizeWhere(
  search: string,
  status?: LeadStatus,
  filters?: {
    leadType?: LeadType;
    source?: string;
    state?: string;
    businessType?: string;
    verificationStatus?: VerificationStatus;
  }
) {
  return {
    ...(status ? { status } : {}),
    ...(filters?.leadType ? { leadType: filters.leadType } : {}),
    ...(filters?.source ? { source: filters.source } : {}),
    ...(filters?.state ? { state: filters.state } : {}),
    ...(filters?.businessType ? { businessType: filters.businessType } : {}),
    ...(filters?.verificationStatus ? { verificationStatus: filters.verificationStatus } : {}),
    ...(search
      ? {
          OR: [
            { companyName: { contains: search, mode: "insensitive" } },
            { contactName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { businessType: { contains: search, mode: "insensitive" } },
            { state: { contains: search, mode: "insensitive" } },
            { city: { contains: search, mode: "insensitive" } },
            { source: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listLeads(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);

    const search = String(req.query.search || "").trim();
    const statusQuery = String(req.query.status || "").trim().toUpperCase();
    const leadTypeQuery = String(req.query.leadType || "").trim().toUpperCase();
    const verificationQuery = String(req.query.verificationStatus || "").trim().toUpperCase();
    const status = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"].includes(statusQuery)
      ? (statusQuery as LeadStatus)
      : undefined;
    const leadType = LEAD_TYPES.includes(leadTypeQuery as LeadType) ? (leadTypeQuery as LeadType) : undefined;
    const verificationStatus = VERIFICATION_STATUSES.includes(verificationQuery as VerificationStatus)
      ? (verificationQuery as VerificationStatus)
      : undefined;
    const source = String(req.query.source || "").trim() || undefined;
    const state = String(req.query.state || "").trim() || undefined;
    const businessType = String(req.query.businessType || "").trim() || undefined;
    const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
    const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || "30"), 10), 1), 200);
    const skip = (page - 1) * pageSize;

    const filters = { leadType, source, state, businessType, verificationStatus };
    const where: any = normalizeWhere(search, status, filters);
    const whereForSummary: any = normalizeWhere(search, undefined, filters);

    const [total, leads, grouped, inboundCount, outboundCount, pendingVerificationCount] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.lead.groupBy({
        by: ["status"],
        where: whereForSummary,
        _count: { _all: true },
      }),
      prisma.lead.count({ where: { ...whereForSummary, leadType: "INBOUND" } }),
      prisma.lead.count({ where: { ...whereForSummary, leadType: "OUTBOUND" } }),
      prisma.lead.count({ where: { ...whereForSummary, verificationStatus: "PENDING" } }),
    ]);

    const statusSummary = {
      NEW: 0,
      CONTACTED: 0,
      QUALIFIED: 0,
      WON: 0,
      LOST: 0,
    };
    for (const row of grouped) {
      statusSummary[row.status as keyof typeof statusSummary] = row._count._all;
    }

    return res.json({
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      statusSummary,
      summary: { inboundCount, outboundCount, pendingVerificationCount },
      leads: leads.map(safeLead),
    });
  } catch (err) {
    next(err);
  }
}

export async function getLeadById(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);
    const id = String(req.params.id || "").trim();
    if (!id) throw new AppError("Lead id is required", 400, "VALIDATION_ERROR");

    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new AppError("Lead not found", 404, "NOT_FOUND");

    return res.json({ lead: safeLead(lead) });
  } catch (err) {
    next(err);
  }
}

export async function createLead(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);
    const companyName = String(req.body.companyName || "").trim();
    if (companyName.length < 2 || companyName.length > 120) {
      throw new AppError("Company name must be between 2 and 120 characters", 400, "VALIDATION_ERROR");
    }

    const leadType = asEnum(req.body.leadType || "OUTBOUND", LEAD_TYPES, "lead type");
    const verificationStatus = asEnum(
      req.body.verificationStatus || (leadType === "OUTBOUND" ? "PENDING" : "NOT_REQUIRED"),
      VERIFICATION_STATUSES,
      "verification status"
    );
    const lead = await prisma.lead.create({
      data: {
        companyName,
        contactName: asOptionalString(req.body.contactName, 120) || "Management / Owner",
        email: asOptionalEmail(req.body.email),
        phone: asOptionalString(req.body.phone, 50),
        businessType: asOptionalString(req.body.businessType, 80),
        message: asOptionalString(req.body.message, 1000),
        source: asOptionalString(req.body.source, 80) || "manual",
        sourceUrl: asOptionalString(req.body.sourceUrl, 500),
        contactSourceUrl: asOptionalString(req.body.contactSourceUrl, 500),
        leadType,
        state: asOptionalString(req.body.state, 80),
        city: asOptionalString(req.body.city, 120),
        address: asOptionalString(req.body.address, 500),
        roomCount: asOptionalRoomCount(req.body.roomCount),
        verificationStatus,
        assignedTo: asOptionalString(req.body.assignedTo, 120),
        notes: asOptionalString(req.body.notes, 2000),
        lastActivityAt: new Date(),
      },
    });
    return res.status(201).json({ lead: safeLead(lead) });
  } catch (err) {
    next(err);
  }
}

export async function importHotelsNgProspects(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);
    const sourceUrls = hotelsNgProspects.map((prospect) => prospect.sourceUrl);
    const existing = await prisma.lead.findMany({
      where: { source: "hotels.ng", sourceUrl: { in: sourceUrls } },
      select: { id: true, sourceUrl: true, email: true, phone: true, contactSourceUrl: true },
    });
    const existingBySourceUrl = new Map(existing.filter((lead) => lead.sourceUrl).map((lead) => [lead.sourceUrl!, lead]));
    const existingUrls = new Set(existingBySourceUrl.keys());
    const pending = hotelsNgProspects.filter((prospect) => !existingUrls.has(prospect.sourceUrl));

    if (pending.length > 0) {
      await prisma.lead.createMany({
        data: pending.map((prospect) => ({
          companyName: prospect.companyName,
          contactName: "Management / Owner",
          email: prospect.contact?.email,
          phone: prospect.contact?.phone,
          businessType: prospect.businessType,
          message: "Imported prospect. Verify property contact details and actual room inventory before outreach.",
          source: "hotels.ng",
          sourceUrl: prospect.sourceUrl,
          contactSourceUrl: prospect.contact?.sourceUrl,
          leadType: "OUTBOUND",
          state: prospect.state,
          city: prospect.city,
          address: prospect.address,
          roomCount: prospect.roomCount,
          verificationStatus: "PENDING",
          lastActivityAt: new Date(),
        })),
      });
    }

    const refreshedContacts = hotelsNgProspects.filter((prospect) => {
      const current = existingBySourceUrl.get(prospect.sourceUrl);
      return Boolean(
        current &&
          prospect.contact &&
          ((!current.email && prospect.contact.email) ||
            (!current.phone && prospect.contact.phone) ||
            (!current.contactSourceUrl && prospect.contact.sourceUrl))
      );
    });
    if (refreshedContacts.length > 0) {
      await prisma.$transaction(
        refreshedContacts.map((prospect) => {
          const current = existingBySourceUrl.get(prospect.sourceUrl)!;
          return prisma.lead.update({
            where: { id: current.id },
            data: {
              ...(!current.email && prospect.contact?.email ? { email: prospect.contact.email } : {}),
              ...(!current.phone && prospect.contact?.phone ? { phone: prospect.contact.phone } : {}),
              ...(!current.contactSourceUrl && prospect.contact?.sourceUrl ? { contactSourceUrl: prospect.contact.sourceUrl } : {}),
              lastActivityAt: new Date(),
            },
          });
        })
      );
    }

    return res.status(201).json({
      imported: pending.length,
      skipped: hotelsNgProspects.length - pending.length,
      contactsRefreshed: refreshedContacts.length,
      totalAvailable: hotelsNgProspects.length,
      message: pending.length
        ? `${pending.length} Hotels.ng prospects imported for contact verification.`
        : refreshedContacts.length
          ? `${refreshedContacts.length} existing prospects received newly researched public contact details.`
          : "All reviewed Hotels.ng prospects are already in the pipeline.",
    });
  } catch (err) {
    next(err);
  }
}

export async function previewLeadIntroductionEmail(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);
    const id = String(req.params.id || "").trim();
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new AppError("Lead not found", 404, "NOT_FOUND");
    if (!lead.email) throw new AppError("Lead email is not maintained", 400, "LEAD_EMAIL_REQUIRED");

    const message = buildLeadIntroductionEmail({
      to: lead.email,
      companyName: lead.companyName,
      contactName: lead.contactName,
      businessType: lead.businessType,
      city: lead.city,
      state: lead.state,
    });
    return res.json({ to: lead.email, subject: message.subject, html: message.html, alreadySentAt: lead.introEmailSentAt });
  } catch (err) {
    next(err);
  }
}

export async function sendLeadIntroduction(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);
    const id = String(req.params.id || "").trim();
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new AppError("Lead not found", 404, "NOT_FOUND");
    if (!lead.email) throw new AppError("Lead email is not maintained", 400, "LEAD_EMAIL_REQUIRED");
    if (lead.verificationStatus !== "VERIFIED") {
      throw new AppError("Verify the lead's direct email before sending an introduction", 400, "LEAD_CONTACT_NOT_VERIFIED");
    }
    if (lead.introEmailSentAt) {
      throw new AppError("An introductory email has already been sent to this lead", 409, "LEAD_INTRO_ALREADY_SENT");
    }
    if (!isResendEmailConfigured()) {
      throw new AppError("Email delivery is not configured. Set EMAIL_PROVIDER=RESEND and RESEND_API_KEY.", 503, "EMAIL_NOT_CONFIGURED");
    }

    const message = await sendLeadIntroductionEmail({
      to: lead.email,
      companyName: lead.companyName,
      contactName: lead.contactName,
      businessType: lead.businessType,
      city: lead.city,
      state: lead.state,
    });
    const now = new Date();
    const updated = await prisma.lead.update({
      where: { id },
      data: {
        ...(lead.status === "NEW" ? { status: "CONTACTED", contactedAt: lead.contactedAt ?? now } : {}),
        introEmailSentAt: now,
        introEmailSubject: message.subject,
        lastActivityAt: now,
      },
    });
    return res.json({ lead: safeLead(updated), message: "Introduction email sent and logged." });
  } catch (err) {
    next(err);
  }
}

export async function updateLead(req: Request, res: Response, next: NextFunction) {
  try {
    await requireSuperAdmin(req);
    const id = String(req.params.id || "").trim();
    if (!id) throw new AppError("Lead id is required", 400, "VALIDATION_ERROR");

    const { status, assignedTo, notes } = req.body as {
      status?: LeadStatus;
      assignedTo?: string | null;
      notes?: string | null;
    };

    if (status !== undefined && !["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"].includes(status)) {
      throw new AppError("Invalid lead status", 400, "VALIDATION_ERROR");
    }

    const current = await prisma.lead.findUnique({
      where: { id },
      select: { status: true, contactedAt: true, contactVerifiedAt: true },
    });
    if (!current) throw new AppError("Lead not found", 404, "NOT_FOUND");

    const nextStatus = status ?? current.status;
    const shouldSetContactedAt = nextStatus === "CONTACTED" && !current.contactedAt;
    const contactVerified = req.body.contactVerified === undefined ? undefined : Boolean(req.body.contactVerified);

    const updated = await prisma.lead.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(req.body.companyName !== undefined ? { companyName: String(req.body.companyName || "").trim() } : {}),
        ...(req.body.contactName !== undefined ? { contactName: asOptionalString(req.body.contactName, 120) || "Management / Owner" } : {}),
        ...(req.body.email !== undefined ? { email: asOptionalEmail(req.body.email) } : {}),
        ...(req.body.phone !== undefined ? { phone: asOptionalString(req.body.phone, 50) } : {}),
        ...(req.body.businessType !== undefined ? { businessType: asOptionalString(req.body.businessType, 80) } : {}),
        ...(req.body.sourceUrl !== undefined ? { sourceUrl: asOptionalString(req.body.sourceUrl, 500) } : {}),
        ...(req.body.contactSourceUrl !== undefined ? { contactSourceUrl: asOptionalString(req.body.contactSourceUrl, 500) } : {}),
        ...(req.body.state !== undefined ? { state: asOptionalString(req.body.state, 80) } : {}),
        ...(req.body.city !== undefined ? { city: asOptionalString(req.body.city, 120) } : {}),
        ...(req.body.address !== undefined ? { address: asOptionalString(req.body.address, 500) } : {}),
        ...(req.body.roomCount !== undefined ? { roomCount: asOptionalRoomCount(req.body.roomCount) } : {}),
        ...(req.body.verificationStatus !== undefined
          ? { verificationStatus: asEnum(req.body.verificationStatus, VERIFICATION_STATUSES, "verification status") }
          : {}),
        ...(assignedTo !== undefined ? { assignedTo: assignedTo?.trim() || null } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
        ...(contactVerified === true
          ? { verificationStatus: "VERIFIED", contactVerifiedAt: current.contactVerifiedAt ?? new Date() }
          : contactVerified === false
            ? { verificationStatus: "PENDING", contactVerifiedAt: null }
            : {}),
        ...(shouldSetContactedAt ? { contactedAt: new Date() } : {}),
        lastActivityAt: new Date(),
      },
    });

    return res.json({ lead: safeLead(updated) });
  } catch (err) {
    next(err);
  }
}
