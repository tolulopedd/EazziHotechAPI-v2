/* eslint-disable no-console */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const TENANT_ID_ARG = process.argv.find((a) => a.startsWith("--tenant="));
const TARGET_TENANT_ID = TENANT_ID_ARG ? TENANT_ID_ARG.split("=")[1] : "";

const TEXT_MARKERS = [
  "test",
  "demo",
  "dummy",
  "sample",
  "fake",
  "qa",
  "sandbox",
  "staging",
  "trial",
];
const EMAIL_MARKERS = [
  "@example.com",
  "@test.com",
  "@mailinator.com",
  "@tempmail",
  "@yopmail",
  "+test",
  "+demo",
];

function hasMarker(value) {
  if (!value) return false;
  const s = String(value).toLowerCase();
  return TEXT_MARKERS.some((m) => s.includes(m));
}

function isTestEmail(email) {
  if (!email) return false;
  const e = String(email).toLowerCase().trim();
  return EMAIL_MARKERS.some((m) => e.includes(m)) || hasMarker(e);
}

function isTestPhone(phone) {
  if (!phone) return false;
  const p = String(phone).replace(/\s+/g, "");
  return /000000|111111|12345|99999/.test(p);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function pickTenant(where = {}) {
  return TARGET_TENANT_ID ? { ...where, tenantId: TARGET_TENANT_ID } : where;
}

async function main() {
  console.log(`[cleanup] mode=${APPLY ? "APPLY" : "DRY_RUN"} tenant=${TARGET_TENANT_ID || "ALL"}`);

  const superAdminEmails = String(process.env.SUPERADMIN_EMAILS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const [leads, guests, properties, units, bookings, users] = await Promise.all([
    prisma.lead.findMany({
      select: { id: true, email: true, companyName: true, contactName: true, businessType: true, source: true },
    }),
    prisma.guest.findMany({
      where: pickTenant(),
      select: { id: true, tenantId: true, fullName: true, email: true, phone: true, address: true, nationality: true },
    }),
    prisma.property.findMany({
      where: pickTenant(),
      select: { id: true, tenantId: true, name: true, address: true },
    }),
    prisma.unit.findMany({
      where: pickTenant(),
      select: { id: true, tenantId: true, propertyId: true, name: true },
    }),
    prisma.booking.findMany({
      where: pickTenant(),
      select: {
        id: true,
        tenantId: true,
        guestId: true,
        unitId: true,
        guestName: true,
        guestEmail: true,
        guestPhone: true,
        guestAddress: true,
        guestNationality: true,
      },
    }),
    prisma.user.findMany({
      where: pickTenant(),
      select: { id: true, tenantId: true, email: true, fullName: true, role: true },
    }),
  ]);

  const testLeadIds = leads
    .filter((x) => isTestEmail(x.email) || hasMarker(x.companyName) || hasMarker(x.contactName) || hasMarker(x.businessType) || hasMarker(x.source))
    .map((x) => x.id);

  const testPropertyIds = properties
    .filter((x) => hasMarker(x.name) || hasMarker(x.address))
    .map((x) => x.id);

  const testUnitIds = units
    .filter((x) => hasMarker(x.name) || testPropertyIds.includes(x.propertyId))
    .map((x) => x.id);

  const testGuestIds = guests
    .filter(
      (x) =>
        hasMarker(x.fullName) ||
        isTestEmail(x.email) ||
        isTestPhone(x.phone) ||
        hasMarker(x.address) ||
        hasMarker(x.nationality)
    )
    .map((x) => x.id);

  const testBookingIds = bookings
    .filter(
      (x) =>
        testGuestIds.includes(x.guestId) ||
        testUnitIds.includes(x.unitId) ||
        hasMarker(x.guestName) ||
        isTestEmail(x.guestEmail) ||
        isTestPhone(x.guestPhone) ||
        hasMarker(x.guestAddress) ||
        hasMarker(x.guestNationality)
    )
    .map((x) => x.id);

  // Delete only guests with no remaining non-test bookings.
  const nonTestBookingGuestIds = unique(
    bookings.filter((b) => !testBookingIds.includes(b.id)).map((b) => b.guestId)
  );
  const deletableGuestIds = testGuestIds.filter((id) => !nonTestBookingGuestIds.includes(id));

  // Delete only units with no remaining non-test bookings.
  const nonTestBookingUnitIds = unique(
    bookings.filter((b) => !testBookingIds.includes(b.id)).map((b) => b.unitId)
  );
  const deletableUnitIds = testUnitIds.filter((id) => !nonTestBookingUnitIds.includes(id));

  // Delete only properties with no remaining units after unit cleanup.
  const remainingUnits = units.filter((u) => !deletableUnitIds.includes(u.id));
  const remainingPropertyIds = unique(remainingUnits.map((u) => u.propertyId));
  const deletablePropertyIds = testPropertyIds.filter((id) => !remainingPropertyIds.includes(id));

  const deletableUserIds = users
    .filter((u) => {
      const email = String(u.email || "").trim().toLowerCase();
      if (!email) return false;
      if (superAdminEmails.includes(email)) return false;
      return isTestEmail(email) || hasMarker(u.fullName);
    })
    .map((u) => u.id);

  const summary = {
    leads: testLeadIds.length,
    bookings: testBookingIds.length,
    guests: deletableGuestIds.length,
    units: deletableUnitIds.length,
    properties: deletablePropertyIds.length,
    users: deletableUserIds.length,
  };

  console.table(summary);
  console.log("[cleanup] sample booking ids:", testBookingIds.slice(0, 10));
  console.log("[cleanup] sample guest ids:", deletableGuestIds.slice(0, 10));
  console.log("[cleanup] sample lead ids:", testLeadIds.slice(0, 10));
  console.log("[cleanup] sample user ids:", deletableUserIds.slice(0, 10));

  if (!APPLY) {
    console.log("[cleanup] dry-run complete. Re-run with --apply to delete.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (testBookingIds.length > 0) {
      await tx.checkEvent.deleteMany({ where: { bookingId: { in: testBookingIds } } });
      await tx.bookingCharge.deleteMany({ where: { bookingId: { in: testBookingIds } } });
      await tx.payment.deleteMany({ where: { bookingId: { in: testBookingIds } } });
      await tx.booking.deleteMany({ where: { id: { in: testBookingIds } } });
    }
    if (deletableGuestIds.length > 0) {
      await tx.guest.deleteMany({ where: { id: { in: deletableGuestIds } } });
    }
    if (deletableUnitIds.length > 0) {
      await tx.unit.deleteMany({ where: { id: { in: deletableUnitIds } } });
    }
    if (deletablePropertyIds.length > 0) {
      await tx.property.deleteMany({ where: { id: { in: deletablePropertyIds } } });
    }
    if (testLeadIds.length > 0) {
      await tx.lead.deleteMany({ where: { id: { in: testLeadIds } } });
    }
    if (deletableUserIds.length > 0) {
      await tx.user.deleteMany({ where: { id: { in: deletableUserIds } } });
    }
  });

  console.log("[cleanup] applied successfully.");
}

main()
  .catch((err) => {
    console.error("[cleanup] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
