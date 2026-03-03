import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";
import { resolvePropertyScope, scopedBookingWhere, scopedPaymentWhere, scopedPropertyWhere, scopedUnitWhere } from "../../common/authz/property-scope";

const DASHBOARD_CACHE_TTL_MS = 10_000;
const dashboardCache = new Map<string, { expiresAt: number; data: any }>();

type Role = "ADMIN" | "MANAGER" | "STAFF";
type JwtUser = { userId: string; tenantId: string; role: Role };

type DashboardStats = {
  totalProperties: number;
  totalUnits: number;
  activeBookings: number;
  pendingPayments: number;
  totalRevenue: number;
  occupancyRate: number;
};

function mapBookingStatusToUi(
  s:
    | "PENDING"
    | "CONFIRMED"
    | "CHECKED_IN"
    | "CHECKED_OUT"
    | "CANCELLED"
    | "NO_SHOW"
) {
  if (s === "CONFIRMED" || s === "CHECKED_IN" || s === "CHECKED_OUT") return "confirmed";
  if (s === "CANCELLED" || s === "NO_SHOW") return "completed";
  return "pending";
}

function getStartOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getEndOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as JwtUser | undefined;
    if (!user) throw new AppError("Authentication required", 401, "UNAUTHORIZED");

    const tenantId = (req as any).tenantId as string | undefined;
    if (!tenantId) throw new AppError("Missing tenant context", 400, "TENANT_REQUIRED");

    // Safety: STAFF/MANAGER must never access another tenant
    if (user.role !== "ADMIN" && user.tenantId !== tenantId) {
      throw new AppError("Token tenant mismatch", 401, "TENANT_MISMATCH");
    }

    const propertyScope = await resolvePropertyScope(req);
    const scope = { tenantId };
    const bookingScope = { ...scope, ...scopedBookingWhere(propertyScope) };
    const paymentScope = { ...scope, ...scopedPaymentWhere(propertyScope) };
    const propertyWhere = { ...scope, ...scopedPropertyWhere(propertyScope) };
    const unitWhere = { ...scope, ...scopedUnitWhere(propertyScope) };
    const cacheKey = [tenantId, user.userId, user.role].join("|");
    const nowMs = Date.now();
    const cached = dashboardCache.get(cacheKey);
    if (cached && cached.expiresAt > nowMs) {
      return res.json(cached.data);
    }

    const recentBookingsPromise = prisma.booking.findMany({
      where: bookingScope,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        guestName: true,
        checkIn: true,
        checkOut: true,
        status: true,
        totalAmount: true,
        unit: { select: { property: { select: { name: true } } } },
      },
    });

    const pendingPaymentsPromise = prisma.payment.findMany({
      where: { ...paymentScope, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        amount: true,
        booking: {
          select: {
            guestName: true,
            checkIn: true,
            unit: { select: { property: { select: { name: true } } } },
          },
        },
      },
    });

    const countsPromise = Promise.all([
      prisma.property.count({ where: propertyWhere }),
      prisma.unit.count({ where: unitWhere }),
      prisma.booking.count({
        where: { ...bookingScope, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] } },
      }),
      prisma.payment.count({ where: { ...paymentScope, status: "PENDING" } }),
    ]);

    const now = new Date();
    const startOfToday = getStartOfDay(now);
    const endOfToday = getEndOfDay(now);
    const occupiedTodayPromise = prisma.booking.findMany({
      where: {
        ...scope,
        ...scopedBookingWhere(propertyScope),
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
        checkIn: { lte: endOfToday },
        checkOut: { gt: startOfToday },
      },
      select: { unitId: true },
      distinct: ["unitId"],
    });

    const [bookingRows, paymentRows, [totalProperties, totalUnits, activeBookings, pendingPaymentsCount], occupiedToday] =
      await Promise.all([recentBookingsPromise, pendingPaymentsPromise, countsPromise, occupiedTodayPromise]);

    const recentBookings = bookingRows.map((b) => ({
      id: b.id,
      guestName: b.guestName ?? "Guest",
      propertyName: b.unit.property.name,
      checkIn: b.checkIn.toISOString(),
      checkOut: b.checkOut.toISOString(),
      status: mapBookingStatusToUi(b.status),
      amount: Number(b.totalAmount ?? 0),
    }));

    const pendingPayments = paymentRows.map((p) => {
      // No dueDate in schema; using booking.checkIn as placeholder.
      const due = p.booking.checkIn;
      const overdue = due.getTime() < now.getTime();

      return {
        id: p.id,
        guestName: p.booking.guestName ?? "Guest",
        propertyName: p.booking.unit.property.name,
        amount: Number(p.amount),
        dueDate: due.toISOString(),
        status: overdue ? "overdue" : "pending",
      };
    });

    const occupiedUnitsToday = occupiedToday.length;

    // % (1 decimal place)
    const occupancyRate =
      totalUnits > 0 ? Math.round((occupiedUnitsToday / totalUnits) * 1000) / 10 : 0;

    // Keep pending safe vs fetched sample list
    const pendingPaymentsSafe = Math.max(pendingPaymentsCount, pendingPayments.length);

    // STAFF: operational-only stats, hide revenue
    if (user.role === "STAFF") {
      const stats: DashboardStats = {
        totalProperties,
        totalUnits,
        activeBookings,
        pendingPayments: pendingPaymentsSafe,
        totalRevenue: 0,
        occupancyRate,
      };

      const payload = {
        userRole: "staff",
        stats,
        recentBookings,
        pendingPayments,
      };
      dashboardCache.set(cacheKey, { expiresAt: nowMs + DASHBOARD_CACHE_TTL_MS, data: payload });
      return res.json(payload);
    }

    // MANAGER: operational + finance-lite (no team size)
    if (user.role === "MANAGER") {
      const stats: DashboardStats = {
        totalProperties,
        totalUnits,
        activeBookings,
        pendingPayments: pendingPaymentsSafe,
        totalRevenue: 0,
        occupancyRate,
      };

      const payload = {
        userRole: "manager",
        stats,
        recentBookings,
        pendingPayments,
      };
      dashboardCache.set(cacheKey, { expiresAt: nowMs + DASHBOARD_CACHE_TTL_MS, data: payload });
      return res.json(payload);
    }

    // ADMIN: full visibility
    const [revenueAgg, staffCount] = await Promise.all([
      prisma.payment.aggregate({
        where: { ...paymentScope, status: "CONFIRMED" },
        _sum: { amount: true },
      }),
      prisma.user.count({ where: scope }),
    ]);

    const stats: DashboardStats = {
      totalProperties,
      totalUnits,
      activeBookings,
      pendingPayments: pendingPaymentsSafe,
      totalRevenue: Number(revenueAgg._sum.amount ?? 0),
      occupancyRate,
    };

    const payload = {
      userRole: "admin",
      stats,
      recentBookings,
      pendingPayments,
      staffCount,
    };
    dashboardCache.set(cacheKey, { expiresAt: nowMs + DASHBOARD_CACHE_TTL_MS, data: payload });
    return res.json(payload);
  } catch (err) {
    next(err);
  }
}
