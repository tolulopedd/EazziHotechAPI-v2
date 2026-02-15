import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../prisma/client";
import { AppError } from "../../common/errors/AppError";

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

    const scope = { tenantId };

    // Recent bookings (all roles)
    const bookingRows = await prisma.booking.findMany({
      where: scope,
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

    const recentBookings = bookingRows.map((b) => ({
      id: b.id,
      guestName: b.guestName ?? "Guest",
      propertyName: b.unit.property.name,
      checkIn: b.checkIn.toISOString(),
      checkOut: b.checkOut.toISOString(),
      status: mapBookingStatusToUi(b.status),
      amount: Number(b.totalAmount ?? 0),
    }));

    // Pending payments (all roles)
    const paymentRows = await prisma.payment.findMany({
      where: { ...scope, status: "PENDING" },
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

    const now = new Date();
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

    // Core operational stats (all roles)
    const [totalProperties, totalUnits, activeBookings, pendingPaymentsCount] = await Promise.all([
      prisma.property.count({ where: scope }),
      prisma.unit.count({ where: scope }),
      prisma.booking.count({
        where: { ...scope, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] } },
      }),
      prisma.payment.count({ where: { ...scope, status: "PENDING" } }),
    ]);

    // Occupancy from active stays today (distinct unitId)
    const startOfToday = getStartOfDay(now);
    const endOfToday = getEndOfDay(now);

    const occupiedToday = await prisma.booking.findMany({
      where: {
        ...scope,
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
        checkIn: { lte: endOfToday },
        checkOut: { gt: startOfToday },
      },
      select: { unitId: true },
      distinct: ["unitId"],
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

      return res.json({
        userRole: "staff",
        stats,
        recentBookings,
        pendingPayments,
      });
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

      return res.json({
        userRole: "manager",
        stats,
        recentBookings,
        pendingPayments,
      });
    }

    // ADMIN: full visibility
    const [revenueAgg, staffCount] = await Promise.all([
      prisma.payment.aggregate({
        where: { ...scope, status: "CONFIRMED" },
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

    return res.json({
      userRole: "admin",
      stats,
      recentBookings,
      pendingPayments,
      staffCount,
    });
  } catch (err) {
    next(err);
  }
}
