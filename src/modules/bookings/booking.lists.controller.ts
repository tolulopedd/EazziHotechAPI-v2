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
  const now = new Date();

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  // Allow overnight same-stay-window arrivals after midnight:
  // include CONFIRMED bookings from yesterday that are still active and not yet checked in.
  const backdateStart = new Date(start);
  backdateStart.setDate(backdateStart.getDate() - 1);

  const bookings = await db.raw.booking.findMany({
    where: {
      tenantId,
      ...scopedBookingWhere(propertyScope),
      status: "CONFIRMED",
      checkedInAt: null,
      OR: [
        {
          checkIn: {
            gte: start,
            lte: end,
          },
        },
        {
          AND: [
            { checkIn: { gte: backdateStart, lt: start } },
            { checkOut: { gt: now } },
          ],
        },
      ],
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
          id: true,
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
