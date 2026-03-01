/* eslint-disable no-console */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function normalizeEmailFrom(value, appName) {
  const raw = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw) return `${appName} <onboarding@resend.dev>`;
  const simple = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const named = /^.+<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>$/;
  if (simple.test(raw) || named.test(raw)) return raw;
  return `${appName} <onboarding@resend.dev>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNairaAmount(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendEmailMessage({ to, subject, html, consoleFallback }) {
  const provider = (process.env.EMAIL_PROVIDER || "CONSOLE").trim().toUpperCase();
  const appName = process.env.APP_NAME || "EazziHotech";
  const from = normalizeEmailFrom(process.env.EMAIL_FROM, appName);
  if (provider === "RESEND") {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[daily-report] RESEND_API_KEY missing, fallback console");
      console.log(consoleFallback);
      return;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend send failed (${res.status}): ${body}`);
    }
    return;
  }
  console.log(consoleFallback);
}

async function sendAdminDailyRevenueReportEmail(input) {
  const reportDate = input.reportDateLabel || "yesterday";
  const subject = `Revenue Report – ${input.tenantName} (${reportDate})`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Dear ${escapeHtml(input.tenantName)} Admin,</p>
      <p>Here's ${escapeHtml(input.tenantName)}${input.propertyAddress ? `, ${escapeHtml(input.propertyAddress)}` : ""} business report for ${escapeHtml(reportDate)}:</p>
      <p>
      - Total Sales Revenue: ₦${escapeHtml(formatNairaAmount(input.totalSalesRevenue))}<br/>
      - Total Payment: ₦${escapeHtml(formatNairaAmount(input.totalPayment))}<br/>
      - Occupancy Rate: ${escapeHtml(String(input.occupancyRatePercent))}%<br/>
      - Total Receivables: ₦${escapeHtml(formatNairaAmount(input.totalReceivables))}
      </p>
      <p>Thank you.</p>
    </div>
  `;
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Daily revenue report for ${input.to} (${input.tenantName})`,
  });
}

function lagosYesterdayBoundsUtc() {
  const now = new Date();
  // Lagos is UTC+1 (no DST)
  const lagosNow = new Date(now.getTime() + 60 * 60 * 1000);
  const y = lagosNow.getUTCFullYear();
  const m = lagosNow.getUTCMonth();
  const d = lagosNow.getUTCDate() - 1;
  const start = new Date(Date.UTC(y, m, d, -1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, d + 1, -1, 0, 0, 0));
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(start);
  return { start, end, label };
}

function computeTotalBillFromBaseAndCharges(baseAmount, charges) {
  const list = charges || [];
  const base = Math.max(0, Number(baseAmount || 0));
  const roomCharges = list.filter((c) => String(c.type || "").toUpperCase() === "ROOM");
  const otherCharges = list.filter((c) => String(c.type || "").toUpperCase() !== "ROOM");
  const roomTotal = roomCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const otherTotal = otherCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const roomComponent = roomCharges.length > 0 ? Math.max(roomTotal, base) : base;
  return Math.max(0, roomComponent + otherTotal);
}

async function run() {
  const { start, end, label } = lagosYesterdayBoundsUtc();
  console.log(`[daily-report] range: ${start.toISOString()} -> ${end.toISOString()} (${label})`);

  const tenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, address: true },
  });

  for (const tenant of tenants) {
    const admins = await prisma.user.findMany({
      where: { tenantId: tenant.id, role: "ADMIN", status: "ACTIVE" },
      select: { email: true },
    });
    const recipients = admins.map((a) => String(a.email || "").trim()).filter(Boolean);
    if (!recipients.length) continue;

    const [bookings, paymentAgg, unitCount, occupiedCountRows] = await Promise.all([
      prisma.booking.findMany({
        where: {
          tenantId: tenant.id,
          status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
          checkIn: { gte: start, lt: end },
        },
        select: {
          totalAmount: true,
          charges: { where: { status: "OPEN" }, select: { amount: true, type: true } },
        },
      }),
      prisma.payment.aggregate({
        where: { tenantId: tenant.id, status: "CONFIRMED", paidAt: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      prisma.unit.count({ where: { tenantId: tenant.id } }),
      prisma.booking.findMany({
        where: {
          tenantId: tenant.id,
          status: "CHECKED_IN",
          checkIn: { lt: end },
          checkOut: { gt: start },
        },
        select: { unitId: true },
        distinct: ["unitId"],
      }),
    ]);

    const totalSalesRevenue = bookings.reduce(
      (sum, b) => sum + computeTotalBillFromBaseAndCharges(Number(b.totalAmount || 0), b.charges || []),
      0
    );
    const totalPayment = Number(paymentAgg?._sum?.amount || 0);

    const outstandingBookings = await prisma.booking.findMany({
      where: {
        tenantId: tenant.id,
        status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
      },
      select: {
        id: true,
        totalAmount: true,
        charges: { where: { status: "OPEN" }, select: { amount: true, type: true } },
        payments: { where: { status: "CONFIRMED" }, select: { amount: true } },
      },
    });
    const totalReceivables = outstandingBookings.reduce((sum, b) => {
      const totalBill = computeTotalBillFromBaseAndCharges(Number(b.totalAmount || 0), b.charges || []);
      const paid = (b.payments || []).reduce((a, p) => a + Number(p.amount || 0), 0);
      return sum + Math.max(0, totalBill - paid);
    }, 0);

    const occupiedUnits = occupiedCountRows.length;
    const occupancyRate = unitCount > 0 ? ((occupiedUnits / unitCount) * 100).toFixed(2) : "0.00";

    for (const to of recipients) {
      await sendAdminDailyRevenueReportEmail({
        to,
        tenantName: tenant.name,
        propertyAddress: tenant.address || null,
        totalSalesRevenue: totalSalesRevenue.toFixed(2),
        totalPayment: totalPayment.toFixed(2),
        occupancyRatePercent: occupancyRate,
        totalReceivables: totalReceivables.toFixed(2),
        reportDateLabel: label,
      });
    }

    console.log(`[daily-report] sent: tenant=${tenant.name}, recipients=${recipients.length}`);
  }

  console.log("[daily-report] done");
}

run()
  .catch((err) => {
    console.error("[daily-report] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
