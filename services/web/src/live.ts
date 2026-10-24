import type { AlertItem, HomeStatus } from "./AegisCare360App";

// Live mode: when /config.json exists (the CDK deploy writes it next to the app), sign-in goes
// to Cognito and the screens show real incidents from the caregiver API. Without it the app
// runs on its built-in demo data. For local dev, copy the deploy outputs into public/config.json.

export interface LiveConfig {
  apiUrl: string;
  region: string;
  userPoolClientId: string;
}

export interface LiveSenior {
  senior_id: string;
  name: string;
  timezone: string;
  status: "NORMAL" | "WATCH" | "ALERT" | "CRITICAL";
  last_activity_at: string | null;
}

interface LiveIncident {
  incident_id: string;
  kind: "SCAM_CALL" | "SCAM_REPORT" | "FALL" | "INACTIVITY" | "HELP_REQUEST";
  status: "OPEN" | "ASKING_SENIOR" | "ESCALATED" | "ACKNOWLEDGED" | "RESOLVED" | "CLOSED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  opened_at: string;
}

interface LiveAlert {
  alert_id: string;
  incident_id: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

export interface Overview {
  senior: LiveSenior;
  incidents: LiveIncident[];
  alerts: LiveAlert[];
}

export async function loadConfig(): Promise<LiveConfig | null> {
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (!res.ok) return null;
    const cfg = (await res.json()) as Partial<LiveConfig>;
    return cfg.apiUrl && cfg.region && cfg.userPoolClientId ? (cfg as LiveConfig) : null;
  } catch {
    return null;
  }
}

/** Cognito USER_PASSWORD_AUTH; returns the ID token, which carries the email claim the API uses. */
export async function signIn(cfg: LiveConfig, email: string, password: string): Promise<string> {
  const res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth" },
    body: JSON.stringify({ AuthFlow: "USER_PASSWORD_AUTH", ClientId: cfg.userPoolClientId, AuthParameters: { USERNAME: email, PASSWORD: password } }),
  });
  const out = (await res.json()) as { AuthenticationResult?: { IdToken?: string }; ChallengeName?: string; message?: string };
  if (!res.ok) throw new Error(out.message ?? "Sign-in failed");
  if (out.ChallengeName === "NEW_PASSWORD_REQUIRED") throw new Error("This account still has a temporary password. Ask the admin to set a permanent one.");
  if (!out.AuthenticationResult?.IdToken) throw new Error(`Sign-in needs another step (${out.ChallengeName ?? "unknown"})`);
  return out.AuthenticationResult.IdToken;
}

export class LiveApi {
  constructor(
    private readonly cfg: LiveConfig,
    private readonly idToken: string,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.idToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(out.error ?? (res.status === 401 ? "Your session expired. Please sign in again." : `Request failed (${res.status})`));
    return out;
  }

  me() {
    return this.call<{ seniors: LiveSenior[] }>("GET", "/me");
  }

  overview(seniorId: string) {
    return this.call<Overview>("GET", `/seniors/${seniorId}/overview`);
  }

  acknowledge(alertId: string, action: "ACK" | "CALLED_SENIOR" | "CALLED_EMERGENCY" | "FALSE_ALARM") {
    return this.call<{ alert_id: string }>("POST", `/alerts/${alertId}/ack`, { action });
  }
}

export function homeStatusFor(status: LiveSenior["status"]): HomeStatus {
  if (status === "CRITICAL") return "EMERGENCY";
  if (status === "ALERT" || status === "WATCH") return "NEEDS_VERIFICATION";
  return "OK";
}

const KIND: Record<LiveIncident["kind"], { icon: string; label: string }> = {
  SCAM_CALL: { icon: "phone_disabled", label: "Phone call" },
  SCAM_REPORT: { icon: "report", label: "Reported message" },
  FALL: { icon: "personal_injury", label: "Home sensors" },
  INACTIVITY: { icon: "schedule", label: "Home sensors" },
  HELP_REQUEST: { icon: "sos", label: "Alexa" },
};

const STATUS_TEXT: Record<LiveIncident["status"], string> = {
  OPEN: "Open",
  ASKING_SENIOR: "Waiting for an answer from the senior",
  ESCALATED: "Family alerted",
  ACKNOWLEDGED: "A caregiver is on it",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today · ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

/** Live incidents in the shape the screens already render. */
export function toAlertItems(overview: Overview): AlertItem[] {
  return overview.incidents.map((i) => {
    const done = i.status === "RESOLVED" || i.status === "CLOSED" || i.status === "ACKNOWLEDGED";
    const alert = overview.alerts.find((a) => a.incident_id === i.incident_id);
    return {
      id: i.incident_id,
      title: alert?.title ?? i.title,
      description: alert?.body ?? STATUS_TEXT[i.status],
      time: when(i.opened_at),
      location: `${KIND[i.kind].label} · ${STATUS_TEXT[i.status]}`,
      category: done ? "resolved" : i.severity === "CRITICAL" ? "emergency" : "needs_review",
      priority: done ? "RESOLVED" : i.severity === "CRITICAL" ? "CRITICAL" : i.severity === "HIGH" ? "HIGH" : "NORMAL",
      icon: KIND[i.kind].icon,
    };
  });
}
