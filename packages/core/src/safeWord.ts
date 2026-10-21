import { createHmac, timingSafeEqual } from "node:crypto";

// The spoken safe word is never stored or logged: only an HMAC of its normalised form.
// The pepper lives in Secrets Manager, so a leaked table alone can't be brute-forced offline.

const VERSION = "v1";

/** "Blue  Pelican!" and "blue pelican" are the same answer when spoken. */
export function normalisePhrase(phrase: string): string {
  return phrase
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashSafeWord(phrase: string, pepper: string): string {
  if (pepper.length < 16) throw new Error("safe-word pepper must be at least 16 characters");
  const normalised = normalisePhrase(phrase);
  if (!normalised) throw new Error("safe word is empty after normalising");
  return `${VERSION}:${createHmac("sha256", pepper).update(normalised).digest("hex")}`;
}

export function verifySafeWord(phrase: string, storedHash: string, pepper: string): boolean {
  if (!normalisePhrase(phrase)) return false;
  const candidate = Buffer.from(hashSafeWord(phrase, pepper));
  const stored = Buffer.from(storedHash);
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
