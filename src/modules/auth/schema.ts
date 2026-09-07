import { pgTable, pgEnum, varchar, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { primaryId, auditTimestamps } from "@/core/db/columns";

export const mfaMethodEnum = pgEnum("mfa_method", ["NONE", "TOTP", "EMAIL"]);

/**
 * Credentials live here, apart from the user profile in `/user-admin`.
 *
 * `userId` is a soft reference across a module boundary: no database foreign
 * key, because the two tables are owned by different modules and must stay
 * independently movable. Referential integrity is enforced by the service that
 * creates credentials.
 */
export const credentials = pgTable(
  "auth_credentials",
  {
    id: primaryId(),
    userId: text("user_id").notNull().unique(),
    /** scrypt-derived; never the password itself. */
    passwordHash: varchar("password_hash", { length: 256 }).notNull(),
    passwordSalt: varchar("password_salt", { length: 64 }).notNull(),
    /** Forces a change on next successful login (admin-issued passwords). */
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...auditTimestamps(),
  },
  (t) => [index("auth_credentials_user_idx").on(t.userId)]
);

/** Enrolled second factor. TOTP secrets are stored per user, one row each. */
export const mfaEnrollments = pgTable(
  "auth_mfa_enrollments",
  {
    id: primaryId(),
    userId: text("user_id").notNull().unique(),
    method: mfaMethodEnum("method").notNull().default("NONE"),
    /** Base32 TOTP secret; only present when method = TOTP. */
    secret: varchar("secret", { length: 128 }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...auditTimestamps(),
  },
  (t) => [index("auth_mfa_user_idx").on(t.userId)]
);

export const sessions = pgTable(
  "auth_sessions",
  {
    id: primaryId(),
    userId: text("user_id").notNull(),
    /** SHA-256 of the bearer token. The raw token is only ever returned once. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    /** False until the second factor is satisfied, when MFA is enrolled. */
    mfaSatisfied: boolean("mfa_satisfied").notNull().default(false),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId), index("auth_sessions_expiry_idx").on(t.expiresAt)]
);

export type Credential = typeof credentials.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type MfaEnrollment = typeof mfaEnrollments.$inferSelect;
