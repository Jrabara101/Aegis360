import {
  ACK_ACTIONS,
  DETAIL_TYPES,
  SOURCES,
  commonDetail,
  type AckAction,
  type EventPublisher,
  type IncidentSummary,
  type SeniorRecord,
} from "@aegiscare/core";

// Routes for the caregiver web app. API Gateway has already checked the Cognito ID token;
// this layer decides which seniors the signed-in caregiver may see, from the Caregivers table.

export interface CaregiverLink {
  caregiver_id: string;
  senior_id: string;
  name: string;
  relationship: string;
}

export interface IncidentRow extends IncidentSummary {
  updated_at: string | null;
  closed_at: string | null;
}

export interface AlertRow {
  alert_id: string;
  incident_id: string;
  senior_id: string;
  priority: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  ack_action: string | null;
}

export interface EventRow {
  senior_id: string;
  detail_type: string;
  source: string;
  occurred_at: string;
  detail: Record<string, unknown>;
}

export interface ApiStore {
  caregiversByEmail(email: string): Promise<CaregiverLink[]>;
  getSenior(seniorId: string): Promise<SeniorRecord | undefined>;
  recentIncidents(seniorId: string, limit: number): Promise<IncidentRow[]>;
  recentAlerts(seniorId: string, limit: number): Promise<AlertRow[]>;
  incidentEvents(incidentId: string): Promise<EventRow[]>;
  getAlert(alertId: string): Promise<AlertRow | undefined>;
}

export interface ApiDeps {
  store: ApiStore;
  bus: EventPublisher;
  demo?: boolean;
}

export interface ApiRequest {
  method: string;
  path: string;
  /** The `email` claim of the verified ID token; null if the token had none. */
  email: string | null;
  body?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });
const notFound = () => json(404, { error: "not found" });

// The senior record's safe-word hash never leaves the backend.
function publicSenior(s: SeniorRecord) {
  return { senior_id: s.senior_id, name: s.name, timezone: s.timezone, status: s.status, last_activity_at: s.last_activity_at };
}

export async function handleApi(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  if (!req.email) return json(401, { error: "sign in again" });
  const links = await deps.store.caregiversByEmail(req.email.toLowerCase());
  if (links.length === 0) return json(403, { error: "This account isn't linked to anyone in AegisCare yet." });
  const linkFor = (seniorId: string) => links.find((l) => l.senior_id === seniorId);

  let m: RegExpMatchArray | null;

  if (req.method === "GET" && req.path === "/me") {
    const seniors = await Promise.all(links.map((l) => deps.store.getSenior(l.senior_id)));
    return json(200, {
      caregivers: links,
      seniors: seniors.filter((s): s is SeniorRecord => Boolean(s)).map(publicSenior),
    });
  }

  if (req.method === "GET" && (m = req.path.match(/^\/seniors\/(snr_[0-9A-Za-z_]+)\/overview$/))) {
    const seniorId = m[1]!;
    // A senior the caller isn't linked to looks the same as one that doesn't exist.
    if (!linkFor(seniorId)) return notFound();
    const [senior, incidents, alerts] = await Promise.all([
      deps.store.getSenior(seniorId),
      deps.store.recentIncidents(seniorId, 25),
      deps.store.recentAlerts(seniorId, 25),
    ]);
    if (!senior) return notFound();
    return json(200, { senior: publicSenior(senior), incidents, alerts });
  }

  if (req.method === "GET" && (m = req.path.match(/^\/incidents\/(inc_[0-9A-Za-z_]+)\/events$/))) {
    const events = await deps.store.incidentEvents(m[1]!);
    if (events.length === 0 || !linkFor(events[0]!.senior_id)) return notFound();
    return json(200, { events: events.filter((e) => linkFor(e.senior_id)) });
  }

  if (req.method === "POST" && (m = req.path.match(/^\/alerts\/(alr_[0-9A-Za-z_]+)\/ack$/))) {
    const alert = await deps.store.getAlert(m[1]!);
    const link = alert && linkFor(alert.senior_id);
    if (!alert || !link) return notFound();

    let action: unknown;
    try {
      action = (JSON.parse(req.body ?? "{}") as { action?: unknown }).action ?? "ACK";
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    if (!(ACK_ACTIONS as readonly unknown[]).includes(action)) return json(400, { error: `action must be one of ${ACK_ACTIONS.join(", ")}` });

    await deps.bus.publish(SOURCES.app, DETAIL_TYPES.alertAcknowledged, {
      ...commonDetail({ senior_id: alert.senior_id, incident_id: alert.incident_id, correlation_id: alert.alert_id, demo: deps.demo }),
      alert_id: alert.alert_id,
      caregiver_id: link.caregiver_id,
      action: action as AckAction,
    });
    return json(202, { alert_id: alert.alert_id, action });
  }

  return notFound();
}
