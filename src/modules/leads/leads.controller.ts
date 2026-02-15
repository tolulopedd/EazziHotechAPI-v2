import type { NextFunction, Request, Response } from "express";
import type { LeadStatus } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { isSuperAdminEmail } from "../../common/auth/superadmin";

type Role = "ADMIN" | "MANAGER" | "STAFF";
type JwtUser = { userId: string; tenantId: string; role: Role };

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
    ip: l.ip,
    status: l.status,
    assignedTo: l.assignedTo,
    notes: l.notes,
    contactedAt: l.contactedAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

function normalizeWhere(search: string, status?: LeadStatus) {
  return {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { companyName: { contains: search, mode: "insensitive" } },
            { contactName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { businessType: { contains: search, mode: "insensitive" } },
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
    const status = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"].includes(statusQuery)
      ? (statusQuery as LeadStatus)
      : undefined;
    const page = Math.max(parseInt(String(req.query.page || "1"), 10), 1);
    const pageSize = Math.min(Math.max(parseInt(String(req.query.pageSize || "30"), 10), 1), 200);
    const skip = (page - 1) * pageSize;

    const where: any = normalizeWhere(search, status);
    const whereForSummary: any = normalizeWhere(search, undefined);

    const [total, leads, grouped] = await Promise.all([
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
      select: { status: true, contactedAt: true },
    });
    if (!current) throw new AppError("Lead not found", 404, "NOT_FOUND");

    const nextStatus = status ?? current.status;
    const shouldSetContactedAt = nextStatus === "CONTACTED" && !current.contactedAt;

    const updated = await prisma.lead.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(assignedTo !== undefined ? { assignedTo: assignedTo?.trim() || null } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
        ...(shouldSetContactedAt ? { contactedAt: new Date() } : {}),
      },
    });

    return res.json({ lead: safeLead(updated) });
  } catch (err) {
    next(err);
  }
}
