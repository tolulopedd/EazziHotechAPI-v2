/* eslint-disable no-console */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decimalOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

function normalizePropertyType(value) {
  const v = String(value || 'SHORTLET').trim().toUpperCase();
  return v === 'HOTEL' ? 'HOTEL' : 'SHORTLET';
}

function normalizeUnitType(value) {
  const v = String(value || 'ROOM').trim().toUpperCase();
  return v === 'APARTMENT' ? 'APARTMENT' : 'ROOM';
}

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME || 'DTT Properties Limited';
  const tenantSlug = process.env.SEED_TENANT_SLUG || 'dtt-properties';
  const tenantEmail = process.env.SEED_TENANT_EMAIL || 'admin@dttshortlet.com';
  const tenantPhone = process.env.SEED_TENANT_PHONE || null;
  const tenantAddress = process.env.SEED_TENANT_ADDRESS || null;

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@dttshortlet.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';
  const adminFullName = process.env.SEED_ADMIN_FULL_NAME || 'Tenant Admin';

  if (!adminPassword || adminPassword.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD is required and must be at least 8 characters.');
  }

  const settings = {
    minDepositPercent: intEnv('SEED_MIN_DEPOSIT_PERCENT', 100),
    maxProperties: intEnv('SEED_MAX_PROPERTIES', 20),
    maxUnits: intEnv('SEED_MAX_UNITS', 500),
    maxUsers: intEnv('SEED_MAX_USERS', 100),
  };

  let propertiesSpec = [];
  if (process.env.SEED_PROPERTIES_JSON) {
    try {
      const parsed = JSON.parse(process.env.SEED_PROPERTIES_JSON);
      propertiesSpec = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      throw new Error(`SEED_PROPERTIES_JSON must be valid JSON array: ${error.message}`);
    }
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: {
      name: tenantName,
      email: tenantEmail,
      phone: tenantPhone,
      address: tenantAddress,
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
    },
    create: {
      name: tenantName,
      slug: tenantSlug,
      email: tenantEmail,
      phone: tenantPhone,
      address: tenantAddress,
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
    },
  });

  const tenantSettings = await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: settings,
    create: {
      tenantId: tenant.id,
      ...settings,
    },
  });

  const admin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: adminEmail,
      },
    },
    update: {
      fullName: adminFullName,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    create: {
      tenantId: tenant.id,
      email: adminEmail,
      fullName: adminFullName,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  let createdProperties = 0;
  let createdUnits = 0;

  for (const prop of propertiesSpec) {
    const property = await prisma.property.create({
      data: {
        tenantId: tenant.id,
        name: String(prop.name || '').trim() || 'Property',
        type: normalizePropertyType(prop.type),
        address: prop.address ? String(prop.address).trim() : null,
      },
    });
    createdProperties += 1;

    const units = Array.isArray(prop.units) ? prop.units : [];
    for (const unit of units) {
      await prisma.unit.create({
        data: {
          tenantId: tenant.id,
          propertyId: property.id,
          name: String(unit.name || '').trim() || `Unit-${createdUnits + 1}`,
          type: normalizeUnitType(unit.type),
          capacity: Number.isFinite(Number(unit.capacity)) ? Math.max(1, Number(unit.capacity)) : 1,
          basePrice: decimalOrNull(unit.basePrice),
        },
      });
      createdUnits += 1;
    }
  }

  console.log('[seed-day0] completed');
  console.table({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    adminUserId: admin.id,
    minDepositPercent: tenantSettings.minDepositPercent,
    propertiesCreated: createdProperties,
    unitsCreated: createdUnits,
  });
}

main()
  .catch((error) => {
    console.error('[seed-day0] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
