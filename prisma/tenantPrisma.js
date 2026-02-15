"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prismaForTenant = prismaForTenant;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function withTenantWhere(tenantId, where) {
    return { tenantId, ...(where ?? {}) };
}
function ensureTenantId(tenantId) {
    if (!tenantId)
        throw new Error("tenantId is required for tenant-scoped prisma");
}
function prismaForTenant(tenantId) {
    ensureTenantId(tenantId);
    return {
        property: {
            create: (args) => prisma.property.create({
                ...args,
                data: { ...args.data, tenantId },
            }),
            findMany: (args = {}) => prisma.property.findMany({
                ...args,
                where: withTenantWhere(tenantId, args.where),
            }),
            findById: (id, args = {}) => prisma.property.findFirst({
                ...args,
                where: { id, tenantId },
            }),
            updateById: (id, args) => prisma.property.update({
                ...args,
                where: { id },
                data: { ...args.data },
            }),
            // NOTE: updateById is safe ONLY if you first verify ownership (see controllers below).
        },
        unit: {
            create: (args) => prisma.unit.create({
                ...args,
                data: { ...args.data, tenantId },
            }),
            findMany: (args = {}) => prisma.unit.findMany({
                ...args,
                where: withTenantWhere(tenantId, args.where),
            }),
            findById: (id, args = {}) => prisma.unit.findFirst({
                ...args,
                where: { id, tenantId },
            }),
        },
        booking: {
            create: (args) => prisma.booking.create({
                ...args,
                data: { ...args.data, tenantId },
            }),
            findMany: (args = {}) => prisma.booking.findMany({
                ...args,
                where: withTenantWhere(tenantId, args.where),
            }),
            findById: (id, args = {}) => prisma.booking.findFirst({
                ...args,
                where: { id, tenantId },
            }),
            updateById: (id, data) => prisma.booking.update({
                where: { id },
                data,
            }),
        },
        payment: {
            create: (args) => prisma.payment.create({
                ...args,
                data: { ...args.data, tenantId },
            }),
            findMany: (args = {}) => prisma.payment.findMany({
                ...args,
                where: withTenantWhere(tenantId, args.where),
            }),
            findById: (id) => prisma.payment.findFirst({ where: { id, tenantId } }),
            updateById: (id, data) => prisma.payment.update({
                where: { id },
                data,
            }),
        },
        checkEvent: {
            create: (args) => prisma.checkEvent.create({
                ...args,
                data: { ...args.data, tenantId },
            }),
            findMany: (args = {}) => prisma.checkEvent.findMany({
                ...args,
                where: withTenantWhere(tenantId, args.where),
            }),
            findById: (id) => prisma.checkEvent.findFirst({ where: { id, tenantId } }),
        },
        // For “non-tenant-owned” things like Tenant itself, keep using raw prisma separately.
        raw: prisma,
    };
}
//# sourceMappingURL=tenantPrisma.js.map