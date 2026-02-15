/* eslint-disable no-console */
require('dotenv').config();

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function hasValue(v) {
  return typeof v === 'string' ? v.trim().length > 0 : Boolean(v);
}

function mask(value) {
  if (!hasValue(value)) return 'MISSING';
  if (String(value).length <= 6) return '******';
  return `${String(value).slice(0, 3)}...${String(value).slice(-3)}`;
}

async function main() {
  const provider = String(process.env.EMAIL_PROVIDER || 'CONSOLE').trim().toUpperCase();

  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL',
    'APP_NAME',
    'EMAIL_PROVIDER',
    'EMAIL_FROM',
  ];

  if (provider === 'RESEND') {
    required.push('RESEND_API_KEY');
  }

  const missing = required.filter((k) => !hasValue(process.env[k]));

  const envSummary = {
    DATABASE_URL: mask(process.env.DATABASE_URL),
    JWT_ACCESS_SECRET: mask(process.env.JWT_ACCESS_SECRET),
    JWT_REFRESH_SECRET: mask(process.env.JWT_REFRESH_SECRET),
    FRONTEND_URL: process.env.FRONTEND_URL || 'MISSING',
    APP_NAME: process.env.APP_NAME || 'MISSING',
    EMAIL_PROVIDER: provider,
    EMAIL_FROM: process.env.EMAIL_FROM || 'MISSING',
    RESEND_API_KEY: provider === 'RESEND' ? mask(process.env.RESEND_API_KEY) : 'N/A',
  };

  const dbCounts = {
    tenants: await prisma.tenant.count(),
    users: await prisma.user.count(),
    adminUsers: await prisma.user.count({ where: { role: 'ADMIN' } }),
    properties: await prisma.property.count(),
    units: await prisma.unit.count(),
    guests: await prisma.guest.count(),
    bookings: await prisma.booking.count(),
    payments: await prisma.payment.count(),
    bookingCharges: await prisma.bookingCharge.count(),
    checkEvents: await prisma.checkEvent.count(),
    leads: await prisma.lead.count(),
  };

  const tenantSummary = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      subscriptionStatus: true,
      _count: {
        select: {
          users: true,
          properties: true,
          units: true,
          bookings: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const warnings = [];

  if (provider === 'RESEND' && /gmail\.com/i.test(String(process.env.EMAIL_FROM || ''))) {
    warnings.push('EMAIL_FROM uses gmail.com. Resend requires a verified sending domain for non-test recipients.');
  }

  if (dbCounts.adminUsers < 1) {
    warnings.push('No ADMIN users found.');
  }

  if (tenantSummary.length < 1) {
    warnings.push('No tenants found. Run day-0 seed script before go-live.');
  }

  if (dbCounts.properties < 1 || dbCounts.units < 1) {
    warnings.push('No properties/units found. Add inventory before accepting bookings.');
  }

  console.log('\n[readiness] Environment');
  console.table(envSummary);

  console.log('\n[readiness] Data totals');
  console.table(dbCounts);

  console.log('\n[readiness] Tenants');
  console.table(
    tenantSummary.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      subscriptionStatus: t.subscriptionStatus,
      users: t._count.users,
      properties: t._count.properties,
      units: t._count.units,
      bookings: t._count.bookings,
    }))
  );

  if (missing.length > 0) {
    console.log('\n[readiness] Missing required env vars:');
    missing.forEach((k) => console.log(`- ${k}`));
  }

  if (warnings.length > 0) {
    console.log('\n[readiness] Warnings:');
    warnings.forEach((w) => console.log(`- ${w}`));
  }

  const passed = missing.length === 0;
  console.log(`\n[readiness] ${passed ? 'PASS' : 'FAIL'}${warnings.length ? ' (with warnings)' : ''}`);

  if (!passed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('[readiness] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
