import { createHash, randomBytes } from "node:crypto";
import { TOKEN_PREFIX } from "./tokens";

/* Server-only half of the token helpers (node:crypto); tokens.ts stays safe for client components. */

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export const hashToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");

/** Shown in the list so a token can be recognised without revealing it: `kx_a1b2c3d4`. */
export const tokenPrefix = (raw: string): string => raw.slice(0, TOKEN_PREFIX.length + 8);
