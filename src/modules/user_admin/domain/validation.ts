import { z } from "zod";
import { ROLE_KEYS } from "./permissions";

export const userStatuses = ["INVITED", "ACTIVE", "SUSPENDED", "DISABLED"] as const;

export const createUserSchema = z.object({
  userName: z
    .string()
    .min(3, "User ID must be at least 3 characters")
    .max(60)
    .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, digits, dot, underscore or hyphen only"),
  firstName: z.string().min(1, "First name is required").max(80),
  lastName: z.string().min(1, "Last name is required").max(80),
  email: z.string().email("Invalid email").max(200),
  roleKey: z.enum(ROLE_KEYS as [string, ...string[]]),
  teamId: z.string().optional(),
  approvalLimitOverride: z.number().int().min(0).optional(),
});

export const updateUserSchema = createUserSchema.partial().extend({
  status: z.enum(userStatuses).optional(),
});

export const createTeamSchema = z.object({
  name: z.string().min(2).max(120),
  costCenter: z.string().max(40).optional(),
  parentTeamId: z.string().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

/** Public view of a user — never carries credentials. */
export const userViewSchema = z.object({
  id: z.string(),
  userName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  role: z.string(),
  roleName: z.string(),
  teamName: z.string().nullable(),
  status: z.string(),
  approvalLimit: z.number().nullable(),
});

export type UserView = z.infer<typeof userViewSchema>;
