import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type Where = Record<string, any>;

function withTenantWhere(tenantId: string, where?: Where): Where {
  return { tenantId, ...(where ?? {}) };
}

function ensureTenantId(tenantId: string) {
  if (!tenantId) throw new Error("tenantId is required for tenant-scoped prisma");
}

export function prismaForTenant(tenantId: string) {
  ensureTenantId(tenantId);

  return {
    property: {
      create: (args: Prisma.PropertyCreateArgs) =>
        prisma.property.create({
          ...args,
          data: { ...(args.data as any), tenantId },
        }),

      findMany: (args: Prisma.PropertyFindManyArgs = {}) =>
        prisma.property.findMany({
          ...args,
          where: withTenantWhere(tenantId, args.where as any),
        }),

      findById: (id: string, args: Omit<Prisma.PropertyFindFirstArgs, "where"> = {}) =>
        prisma.property.findFirst({
          ...args,
          where: { id, tenantId },
        }),

      updateById: (id: string, args: Omit<Prisma.PropertyUpdateArgs, "where">) =>
        prisma.property.update({
          ...(args as any),
          where: { id },
          data: { ...(args.data as any) },
        }),
      // NOTE: updateById is safe ONLY if you first verify ownership (see controllers below).
    },

    unit: {
      create: (args: Prisma.UnitCreateArgs) =>
        prisma.unit.create({
          ...args,
          data: { ...(args.data as any), tenantId },
        }),

      findMany: (args: Prisma.UnitFindManyArgs = {}) =>
        prisma.unit.findMany({
          ...args,
          where: withTenantWhere(tenantId, args.where as any),
        }),

      findById: (id: string, args: Omit<Prisma.UnitFindFirstArgs, "where"> = {}) =>
        prisma.unit.findFirst({
          ...args,
          where: { id, tenantId },
        }),
    },

    booking: {
      create: (args: Prisma.BookingCreateArgs) =>
        prisma.booking.create({
          ...args,
          data: { ...(args.data as any), tenantId },
        }),

      findMany: (args: Prisma.BookingFindManyArgs = {}) =>
        prisma.booking.findMany({
          ...args,
          where: withTenantWhere(tenantId, args.where as any),
        }),

      findById: (id: string, args: Omit<Prisma.BookingFindFirstArgs, "where"> = {}) =>
        prisma.booking.findFirst({
          ...args,
          where: { id, tenantId },
        }),

        updateById: (id: string, data: Prisma.BookingUpdateInput) =>
  prisma.booking.update({
    where: { id },
    data,
  }),

    },

    payment: {
  create: (args: Prisma.PaymentCreateArgs) =>
    prisma.payment.create({
      ...args,
      data: { ...(args.data as any), tenantId },
    }),

  findMany: (args: Prisma.PaymentFindManyArgs = {}) =>
    prisma.payment.findMany({
      ...args,
     where: withTenantWhere(tenantId, args.where as any),

    }),

  findById: (id: string) =>
    prisma.payment.findFirst({ where: { id, tenantId } }),

  updateById: (id: string, data: Prisma.PaymentUpdateInput) =>
    prisma.payment.update({
      where: { id },
      data,
    }),
},

checkEvent: {
  create: (args: Prisma.CheckEventCreateArgs) =>
    prisma.checkEvent.create({
      ...args,
      data: { ...(args.data as any), tenantId },
    }),

  findMany: (args: Prisma.CheckEventFindManyArgs = {}) =>
    prisma.checkEvent.findMany({
      ...args,
     where: withTenantWhere(tenantId, args.where as any),

    }),

  findById: (id: string) =>
    prisma.checkEvent.findFirst({ where: { id, tenantId } }),
},

    // For “non-tenant-owned” things like Tenant itself, keep using raw prisma separately.
    raw: prisma,
  };
}
