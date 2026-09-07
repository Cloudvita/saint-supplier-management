import { z } from "zod";

export const loginSchema = z.object({
  userName: z.string().min(1, "User ID is required").max(60),
  password: z.string().min(1, "Password is required").max(200),
});

export const mfaVerifySchema = z.object({
  sessionToken: z.string().min(10),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const setPasswordSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(12, "Password must be at least 12 characters").max(200),
  mustChange: z.boolean().default(false),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
