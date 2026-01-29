import { z } from "zod";

export const loginSchema = z
  .object({
    tenantSlug: z.string().min(2).optional(),
    tenantId: z.string().uuid().optional(),
    email: z.string().email(),
    password: z.string().min(6),
  })
  .refine((d) => d.tenantSlug || d.tenantId, {
    message: "tenantSlug or tenantId is required",
    path: ["tenantSlug"],
  });
