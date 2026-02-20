import type { Request, Response } from "express";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { prismaForTenant } from "../../../prisma/tenantPrisma";
import { createPresignedGetUrlFromKey, publicUrlFromKey } from "../../common/storage/object-storage";
import { resolvePropertyScope, scopedBookingWhere } from "../../common/authz/property-scope";

/**
 * GET /api/bookings/arrivals/today
 */
export const arrivalsToday = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const bookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      ...scopedBookingWhere(propertyScope),
      status: "CONFIRMED",
      checkIn: {
        gte: start,
        lte: end,
      },
    },
    include: {
      guest: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
        },
      },
      unit: {
        select: {
          name: true,
          type: true,
          property: { select: { name: true } },
        },
      },
    },
    orderBy: { checkIn: "asc" },
  });

  const rows = await Promise.all(
    bookings.map(async (b: any) => ({
      ...b,
      guestPhotoUrl: b.guestPhotoKey
        ? await createPresignedGetUrlFromKey({ key: b.guestPhotoKey, expiresInSec: 3600 })
        : publicUrlFromKey(b.guestPhotoKey),
    }))
  );

  res.json({ bookings: rows });
});

/**
 * GET /api/bookings/inhouse
 */
export const inHouse = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const db = prismaForTenant(tenantId);
  const propertyScope = await resolvePropertyScope(req);

  const search = String(req.query.search || "").trim();

  const bookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      ...scopedBookingWhere(propertyScope),
      status: "CHECKED_IN",
      ...(search
        ? {
            OR: [
              { guestName: { contains: search, mode: "insensitive" } },
              { guestPhone: { contains: search, mode: "insensitive" } },
              { guestEmail: { contains: search, mode: "insensitive" } },
              { unit: { name: { contains: search, mode: "insensitive" } } },
              {
                unit: {
                  property: {
                    name: { contains: search, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      guest: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
        },
      },
      unit: {
        select: {
          name: true,
          type: true,
          property: { select: { name: true } },
        },
      },
    },
    orderBy: { checkedInAt: "desc" },
  });

  const rows = await Promise.all(
    bookings.map(async (b: any) => ({
      ...b,
      guestPhotoUrl: b.guestPhotoKey
        ? await createPresignedGetUrlFromKey({ key: b.guestPhotoKey, expiresInSec: 3600 })
        : publicUrlFromKey(b.guestPhotoKey),
    }))
  );

  res.json({ bookings: rows });
});
