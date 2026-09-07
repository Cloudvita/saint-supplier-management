/**
 * `/auth` — credentials, sessions, MFA and the request guard.
 *
 * Owns tables: auth_credentials, auth_mfa_enrollments, auth_sessions.
 * Depends on `/user-admin` for the role and permission set behind a session;
 * that is the module's one outbound dependency, and it goes through the
 * public barrel.
 */
export {
  login,
  logout,
  setPassword,
  verifyMfa,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  resolveSession,
  contextForUser,
  purgeExpiredSessions,
  type LoginResult,
} from "./services/auth.service";

export { getAuthContext, requireSession, requirePermission, requireCronSecret } from "./guard";

export {
  loginSchema,
  mfaVerifySchema,
  setPasswordSchema,
  type LoginInput,
  type MfaVerifyInput,
  type SetPasswordInput,
} from "./domain/validation";

export { hashPassword, verifyPassword, assertPasswordStrength } from "./domain/password";
export { generateTotpSecret, verifyTotp, totpUri } from "./domain/totp";

export type { Session, Credential, MfaEnrollment } from "./schema";

export { authAgentTools } from "./agent-tools";
