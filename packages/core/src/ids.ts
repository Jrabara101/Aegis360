import { randomBytes } from "node:crypto";

// Crockford base32, as used by ULID.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID: 10 time characters then 16 random ones, so IDs sort by creation time. */
export function ulid(now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (const b of bytes) rand += ALPHABET.charAt(b % 32);
  return time + rand;
}

export type IdPrefix = "snr" | "cg" | "ses" | "inc" | "evt" | "alr" | "ctc";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}

/**
 * Every event about one call shares one incident. Deriving the incident ID from the
 * session ID means the voice service, the threat invoker and the MCP server agree on it
 * without a lookup.
 */
export function incidentIdForSession(sessionId: string): string {
  const body = sessionId.startsWith("ses_") ? sessionId.slice(4) : sessionId;
  return `inc_${body}`;
}
