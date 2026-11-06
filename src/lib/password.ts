import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id (the library default) with 19 MiB of memory, 2 passes and 1 lane.
 * The stored hash string carries its own parameters, so they can be raised later
 * without breaking existing passwords.
 */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/** Hashes a password with a random salt. Store the returned string as is. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/** True only when the password matches. A malformed or empty stored hash returns false instead of throwing. */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}