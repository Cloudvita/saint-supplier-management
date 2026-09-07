import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getEnv } from "@/core/config";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/**
 * scrypt with a per-user salt and a server-side pepper.
 *
 * Node's built-in scrypt is used deliberately: it is memory-hard, needs no
 * native dependency, and keeps the deployment (App Runner / Vercel) free of a
 * build step for bcrypt. The pepper lives in the environment, so a stolen
 * database alone does not permit offline cracking.
 */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password + getEnv().AUTH_PEPPER, salt, KEY_LENGTH);
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await scrypt(password + getEnv().AUTH_PEPPER, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Password policy applied on every set/reset. */
export function assertPasswordStrength(password: string): void {
  const problems: string[] = [];
  if (password.length < 12) problems.push("at least 12 characters");
  if (!/[a-z]/.test(password)) problems.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("a digit");
  if (problems.length) {
    throw new Error(`Password must contain ${problems.join(", ")}`);
  }
}
