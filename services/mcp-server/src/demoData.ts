import { InMemoryDirectory, hashSafeWord } from "@aegiscare/core";

// One demo household, used by the local server, the demo script and the tests.
// Fictional people; the safe word only exists here for the demo.

export const DEMO = {
  seniorId: "snr_demo_rosa",
  seniorName: "Rosa",
  caregivers: [
    { caregiver_id: "cg_demo_ana", name: "Ana", relationship: "daughter", priority: 1 },
    { caregiver_id: "cg_demo_luis", name: "Luis", relationship: "son", priority: 2 },
  ],
  safeWord: "blue pelican",
  token: "dev-household-token",
  pepper: "local-dev-pepper-not-a-secret",
} as const;

export function demoDirectory(): InMemoryDirectory {
  const directory = new InMemoryDirectory();
  directory.seniors.set(DEMO.seniorId, {
    senior_id: DEMO.seniorId,
    name: DEMO.seniorName,
    timezone: "America/Chicago",
    status: "NORMAL",
    safe_word_hash: hashSafeWord(DEMO.safeWord, DEMO.pepper),
    last_activity_at: "2026-10-18T14:05:00Z",
  });
  directory.caregivers.set(DEMO.seniorId, DEMO.caregivers.map((c) => ({ ...c })));
  return directory;
}
