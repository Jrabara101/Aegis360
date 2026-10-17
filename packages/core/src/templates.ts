import type { Severity } from "./enums";

// Contracts doc, section 5. Everything Alexa says to the senior comes from this list;
// the agents never write spoken text.
export const SENIOR_TEMPLATES = {
  WARN_GENERIC: "Be careful. This call has signs of a scam. Don't send money or share codes.",
  SAFE_WORD_PROMPT: "This caller may not be who they say. What's your family safe word?",
  SAFE_WORD_RETRY: "That didn't match. Please try your family safe word once more.",
  SAFE_WORD_FAILED: "That didn't match. Please hang up. I'm letting your family know.",
  SAFE_WORD_PASSED: "Thank you, that matches. You can carry on.",
  CHECK_IN: "Are you okay? Say 'I'm okay' or 'I need help'.",
  CHECK_IN_OK: "Glad you're okay. I'll let your family know all is well.",
  HELP_SENT: "I've told your family. Help is on the way.",
  ALL_CLEAR: "I don't see signs of a scam in that. If anyone asks for money or codes, check with family first.",
  SCAM_REPORT_HIGH: "That has strong signs of a scam. Don't send money or share any codes. I'm letting your family know.",
  HELP_UNREACHABLE: "I couldn't reach your family. If this is an emergency, call 911.",
} as const;

export type TemplateId = keyof typeof SENIOR_TEMPLATES;

export function threatTemplateFor(severity: Severity): TemplateId | null {
  switch (severity) {
    case "LOW":
      return null;
    case "MEDIUM":
      return "WARN_GENERIC";
    case "HIGH":
    case "CRITICAL":
      return "SAFE_WORD_PROMPT";
  }
}
