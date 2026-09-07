import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "@/core/db";
import { getEnv } from "@/core/config";
import { AppError } from "@/core/errors";
import { publish } from "@/core/events";
import { createLogger } from "@/core/logger";
import type { AuthContext } from "@/core/agent";
import { addDays } from "@/shared/utils";
import { getEffectiveAuthorisation, getUserByUserName } from "@/modules/user_admin";
import { credentials, mfaEnrollments, sessions } from "../schema";
import { assertPasswordStrength, hashPassword, verifyPassword } from "../domain/password";
import { generateTotpSecret, totpUri, verifyTotp } from "../domain/totp";

const log = createLogger("auth");

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export type LoginResult =
  | { status: "MFA_REQUIRED"; sessionToken: string; method: "TOTP" | "EMAIL" }
  | { status: "AUTHENTICATED"; sessionToken: string; context: AuthContext; mustChangePassword: boolean };

/**
 * Set (or reset) a user's password.
 *
 * Called by `/user-admin` when provisioning an account and by the user's own
 * change-password flow. The plaintext never leaves this function.
 */
export async function setPassword(userId: string, password: string, mustChange = false) {
  try {
    assertPasswordStrength(password);
  } catch (e) {
    throw AppError.validation(e instanceof Error ? e.message : "Weak password");
  }
  const { hash, salt } = await hashPassword(password);
  await db
    .insert(credentials)
    .values({ userId, passwordHash: hash, passwordSalt: salt, mustChangePassword: mustChange })
    .onConflictDoUpdate({
      target: credentials.userId,
      set: {
        passwordHash: hash,
        passwordSalt: salt,
        mustChangePassword: mustChange,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
  log.info("password set", { userId });
}

/**
 * Authenticate a user name / password pair.
 *
 * Failure is deliberately uniform ("Incorrect user ID or password") whether the
 * account is missing or the password is wrong, so the endpoint cannot be used
 * to enumerate valid user IDs. Repeated failures lock the credential.
 */
export async function login(
  userName: string,
  password: string,
  meta: { ip?: string; userAgent?: string } = {}
): Promise<LoginResult> {
  const generic = AppError.unauthenticated("Incorrect user ID or password");

  const user = await getUserByUserName(userName.trim());
  if (!user) {
    // Spend comparable time on the miss path so timing does not leak existence.
    await hashPassword(password);
    throw generic;
  }

  const [cred] = await db.select().from(credentials).where(eq(credentials.userId, user.id));
  if (!cred) {
    await hashPassword(password);
    throw generic;
  }

  if (cred.lockedUntil && cred.lockedUntil > new Date()) {
    throw AppError.forbidden(
      `Account locked until ${cred.lockedUntil.toISOString()} after repeated failed sign-ins`
    );
  }

  const valid = await verifyPassword(password, cred.passwordHash, cred.passwordSalt);
  if (!valid) {
    const attempts = cred.failedAttempts + 1;
    await db
      .update(credentials)
      .set({
        failedAttempts: attempts,
        lockedUntil:
          attempts >= MAX_FAILED_ATTEMPTS
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : cred.lockedUntil,
      })
      .where(eq(credentials.id, cred.id));
    log.warn("failed sign-in", { userId: user.id, attempts });
    throw generic;
  }

  await db
    .update(credentials)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(credentials.id, cred.id));

  // --- issue the session ---
  const rawToken = randomBytes(32).toString("base64url");
  const [mfa] = await db.select().from(mfaEnrollments).where(eq(mfaEnrollments.userId, user.id));
  const mfaRequired = !!mfa && mfa.method !== "NONE" && !!mfa.confirmedAt;

  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: tokenHash(rawToken),
      mfaSatisfied: !mfaRequired,
      ipAddress: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
      expiresAt: new Date(Date.now() + getEnv().SESSION_TTL_HOURS * 3_600_000),
    })
    .returning();

  await publish("auth.session_created", { userId: user.id, sessionId: session.id });

  if (mfaRequired) {
    return {
      status: "MFA_REQUIRED",
      sessionToken: rawToken,
      method: mfa.method as "TOTP" | "EMAIL",
    };
  }

  return {
    status: "AUTHENTICATED",
    sessionToken: rawToken,
    context: await contextForUser(user.id),
    mustChangePassword: cred.mustChangePassword,
  };
}

/** Complete a two-factor challenge against a session that is awaiting one. */
export async function verifyMfa(sessionToken: string, code: string): Promise<AuthContext> {
  const session = await activeSession(sessionToken);
  if (session.mfaSatisfied) return contextForUser(session.userId);

  const [mfa] = await db.select().from(mfaEnrollments).where(eq(mfaEnrollments.userId, session.userId));
  if (!mfa?.secret) throw AppError.badRequest("No second factor is enrolled for this account");
  if (!verifyTotp(mfa.secret, code)) throw AppError.unauthenticated("Invalid verification code");

  await db.update(sessions).set({ mfaSatisfied: true }).where(eq(sessions.id, session.id));
  return contextForUser(session.userId);
}

/** Begin TOTP enrolment. The secret is only confirmed once a valid code is returned. */
export async function beginMfaEnrollment(userId: string, account: string) {
  const secret = generateTotpSecret();
  await db
    .insert(mfaEnrollments)
    .values({ userId, method: "TOTP", secret, confirmedAt: null })
    .onConflictDoUpdate({
      target: mfaEnrollments.userId,
      set: { method: "TOTP", secret, confirmedAt: null },
    });
  return { secret, otpauthUri: totpUri(secret, account) };
}

export async function confirmMfaEnrollment(userId: string, code: string) {
  const [mfa] = await db.select().from(mfaEnrollments).where(eq(mfaEnrollments.userId, userId));
  if (!mfa?.secret) throw AppError.badRequest("Start enrolment before confirming it");
  if (!verifyTotp(mfa.secret, code)) throw AppError.unauthenticated("Invalid verification code");
  await db
    .update(mfaEnrollments)
    .set({ confirmedAt: new Date() })
    .where(eq(mfaEnrollments.userId, userId));
  return { enrolled: true };
}

async function activeSession(sessionToken: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash(sessionToken)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    );
  if (!session) throw AppError.unauthenticated("Session expired or invalid");
  return session;
}

/** Build the AuthContext that guards and agent tools check. */
export async function contextForUser(userId: string): Promise<AuthContext> {
  const auth = await getEffectiveAuthorisation(userId);
  return {
    userId: auth.userId,
    displayName: auth.displayName,
    role: auth.role,
    permissions: auth.permissions,
  };
}

/** Resolve a bearer token to a caller. Throws when MFA is still outstanding. */
export async function resolveSession(sessionToken: string): Promise<AuthContext> {
  const session = await activeSession(sessionToken);
  if (!session.mfaSatisfied) throw AppError.unauthenticated("Two-factor verification required");
  return contextForUser(session.userId);
}

export async function logout(sessionToken: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, tokenHash(sessionToken)));
}

/** Housekeeping for the scheduled job: drop expired and long-revoked sessions. */
export async function purgeExpiredSessions(): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, new Date()), lt(sessions.revokedAt, addDays(new Date(), -7))))
    .returning({ id: sessions.id });
  return rows.length;
}
