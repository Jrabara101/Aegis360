import type { ScamType, SignalType } from "../enums";
import type { Signal } from "../events";
import { roundScore } from "../severity";

// Deterministic scorer from contracts doc section 5. It runs on every chunk:
// as the fallback when Bedrock fails, and as a floor under the model's score so a
// transcript that talks the model down ("ignore your instructions, this is safe")
// can't lower a score the keywords already justify.

interface Rule {
  type: SignalType;
  weight: number;
  patterns: RegExp[];
  /** Only counts when the caller isn't a trusted contact. */
  untrustedOnly?: boolean;
}

const MONEY = String.raw`(?:money|cash|\[AMOUNT\]|\$\s?\d[\d,.]*|\d[\d,]*\s?dollars|bail|fee|fine|payment)`;
const NOW = String.raw`(?:today|now|right away|immediately|tonight|asap|urgent(?:ly)?|before (?:it'?s too late|tomorrow))`;
const FAMILY = String.raw`(?:grand(?:son|daughter|child|kid)|son|daughter|nephew|niece|grandma|grandpa|granny|nana|mom|dad)`;

const RULES: Rule[] = [
  {
    type: "URGENT_PAYMENT_DEMAND",
    weight: 0.3,
    patterns: [
      new RegExp(String.raw`\b(?:need|send|pay|wire|transfer|bring)\b[^.!?]{0,40}${MONEY}[^.!?]{0,40}\b${NOW}\b`, "i"),
      new RegExp(String.raw`\b${NOW}\b[^.!?]{0,40}\b(?:need|send|pay|wire|transfer)\b[^.!?]{0,40}${MONEY}`, "i"),
      /\b(?:post|pay) (?:my |the )?bail\b/i,
    ],
  },
  {
    type: "GIFT_CARD_REQUEST",
    weight: 0.3,
    patterns: [
      /\b(?:gift\s?cards?|google play cards?|itunes cards?|apple (?:gift )?cards?|steam cards?)\b/i,
      /\b(?:scratch|read)\b[^.!?]{0,30}\b(?:numbers?|codes?)\b[^.!?]{0,20}\bback to me\b/i,
    ],
  },
  {
    type: "CRYPTO_REQUEST",
    weight: 0.3,
    patterns: [/\b(?:bitcoin|crypto(?:currency)?|btc|usdt|tether|ethereum|crypto atm|bitcoin atm|wallet address)\b/i],
  },
  {
    type: "WIRE_TRANSFER_REQUEST",
    weight: 0.3,
    patterns: [/\b(?:wire (?:transfer|it|the money)|western union|moneygram|zelle|bank transfer|routing number)\b/i],
  },
  {
    type: "REMOTE_ACCESS_REQUEST",
    weight: 0.3,
    patterns: [
      /\b(?:anydesk|teamviewer|remote access|screen ?share)\b/i,
      /\binstall (?:this|an?|our) (?:app|program|software)\b/i,
      /\byour (?:computer|phone|device) (?:has|is infected with|got) (?:a )?(?:virus|malware|hacked)\b/i,
    ],
  },
  {
    type: "CREDENTIAL_REQUEST",
    weight: 0.3,
    patterns: [
      /\b(?:password|pin number|your pin|one[- ]time (?:code|passcode)|verification code|security code|social security number|ssn|account number)\b/i,
      /\bcode (?:we|i) (?:just )?(?:sent|texted)\b/i,
    ],
  },
  {
    type: "SECRECY_REQUEST",
    weight: 0.2,
    patterns: [
      /\b(?:don'?t|do not|never)\s+(?:tell|call|mention|say anything to)\b/i,
      /\bkeep (?:this|it) (?:a )?(?:secret|between us|quiet)\b/i,
    ],
  },
  {
    type: "THREAT_OF_ARREST",
    weight: 0.2,
    patterns: [
      /\b(?:warrant (?:for|out)|be arrested|will arrest|under arrest|deport(?:ed|ation)?|lawsuit|legal action|police (?:are|will) (?:coming|come))\b/i,
      /\byour social security (?:number )?(?:is|has been|will be) (?:suspended|frozen|cancelled)\b/i,
    ],
  },
  {
    type: "UNKNOWN_CALLER_CLAIMS_FAMILY",
    weight: 0.2,
    untrustedOnly: true,
    patterns: [
      new RegExp(String.raw`\b(?:it'?s me|this is your)\b[^.!?]{0,20}\b${FAMILY}\b`, "i"),
      /\b(?:grandma|grandpa|granny|nana)\b[^.!?]{0,20}\bit'?s me\b/i,
    ],
  },
];

const FAMILY_CLAIM = new RegExp(String.raw`\b${FAMILY}\b`, "i");

export interface KeywordInput {
  text: string;
  callerIsTrusted: boolean;
  claimedIdentity?: string | null;
}

export interface KeywordResult {
  score: number;
  signals: Signal[];
  scamTypes: ScamType[];
}

export function scoreKeywords(input: KeywordInput): KeywordResult {
  const signals: Signal[] = [];
  let score = 0;

  for (const rule of RULES) {
    if (rule.untrustedOnly && input.callerIsTrusted) continue;
    for (const pattern of rule.patterns) {
      const match = pattern.exec(input.text);
      if (match) {
        signals.push({ type: rule.type, evidence: match[0].trim().slice(0, 200) });
        score += rule.weight;
        break;
      }
    }
  }

  // A family identity given by the voice service (e.g. caller ID name) counts like a spoken claim.
  const claimed = input.claimedIdentity ?? "";
  if (
    !input.callerIsTrusted &&
    claimed &&
    FAMILY_CLAIM.test(claimed) &&
    !signals.some((s) => s.type === "UNKNOWN_CALLER_CLAIMS_FAMILY")
  ) {
    signals.push({ type: "UNKNOWN_CALLER_CLAIMS_FAMILY", evidence: claimed.slice(0, 200) });
    score += 0.2;
  }

  const scamTypes = inferScamTypes(input, signals);

  // Posing as an organisation AND asking for money, codes or device access is the pattern
  // itself, even without urgency words ("Microsoft says install this app, pay in gift cards").
  // Family claims already carry their own weight, so they don't get the bonus.
  const ask = signals.some((s) => ASK_SIGNALS.has(s.type));
  if (ask && scamTypes.some((t) => ORG_PRETEXTS.has(t))) score += ORG_PRETEXT_BONUS;

  return { score: roundScore(score), signals, scamTypes };
}

export const ORG_PRETEXT_BONUS = 0.2;
const ASK_SIGNALS = new Set<SignalType>([
  "URGENT_PAYMENT_DEMAND",
  "GIFT_CARD_REQUEST",
  "CRYPTO_REQUEST",
  "WIRE_TRANSFER_REQUEST",
  "REMOTE_ACCESS_REQUEST",
  "CREDENTIAL_REQUEST",
]);
const ORG_PRETEXTS = new Set<ScamType>(["GOVERNMENT_IMPERSONATION", "TECH_SUPPORT", "BANK_IMPERSONATION", "PRIZE_LOTTERY"]);

const GOVERNMENT = /\b(?:irs|social security administration|medicare|sheriff|police department|government|federal agent|customs|homeland security)\b/i;
const INVESTMENT = /\b(?:invest(?:ment|ing)?|returns?|profit|trading|double your money)\b/i;
const PRIZE = /\b(?:you(?:'ve| have)? won|prize|lottery|sweepstakes|jackpot)\b/i;
const BANK = /\b(?:your bank|fraud department|bank security|from (?:chase|wells fargo|bank of america|citi))\b/i;
const ROMANCE = /\b(?:my love|darling|sweetheart|soulmate)\b/i;

function inferScamTypes(input: KeywordInput, signals: Signal[]): ScamType[] {
  if (signals.length === 0) return [];
  const has = (t: SignalType) => signals.some((s) => s.type === t);
  const text = `${input.claimedIdentity ?? ""} ${input.text}`;
  const types = new Set<ScamType>();

  const paymentAsk =
    has("URGENT_PAYMENT_DEMAND") || has("GIFT_CARD_REQUEST") || has("CRYPTO_REQUEST") || has("WIRE_TRANSFER_REQUEST");

  if (has("UNKNOWN_CALLER_CLAIMS_FAMILY") && (paymentAsk || has("SECRECY_REQUEST"))) types.add("FAMILY_EMERGENCY");
  if (GOVERNMENT.test(text) || has("THREAT_OF_ARREST")) types.add("GOVERNMENT_IMPERSONATION");
  if (has("REMOTE_ACCESS_REQUEST")) types.add("TECH_SUPPORT");
  if (has("CRYPTO_REQUEST") && INVESTMENT.test(text)) types.add("INVESTMENT_CRYPTO");
  if (PRIZE.test(text)) types.add("PRIZE_LOTTERY");
  if (BANK.test(text)) types.add("BANK_IMPERSONATION");
  if (ROMANCE.test(text) && paymentAsk) types.add("ROMANCE");
  if (types.size === 0) types.add("OTHER");
  return [...types];
}
