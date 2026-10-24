import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDirectory } from "@aegiscare/aws";
import type { AlertRow, ApiStore, CaregiverLink, EventRow, IncidentRow } from "./app";

export interface ApiTableNames {
  seniors: string;
  caregivers: string;
  incidents: string;
  events: string;
  alerts: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

export class DynamoApiStore implements ApiStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly directory: DynamoDirectory;

  constructor(
    private readonly tables: ApiTableNames,
    client = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client);
    this.directory = new DynamoDirectory(tables, client);
  }

  async caregiversByEmail(email: string): Promise<CaregiverLink[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.caregivers,
        IndexName: "by_email",
        KeyConditionExpression: "email = :e",
        ExpressionAttributeValues: { ":e": email },
      }),
    );
    return (out.Items ?? []).map((c) => ({
      caregiver_id: String(c.caregiver_id),
      senior_id: String(c.senior_id),
      name: String(c.name ?? ""),
      relationship: String(c.relationship ?? "family"),
    }));
  }

  getSenior(seniorId: string) {
    return this.directory.getSenior(seniorId);
  }

  async recentIncidents(seniorId: string, limit: number): Promise<IncidentRow[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.incidents,
        KeyConditionExpression: "senior_id = :s",
        ExpressionAttributeValues: { ":s": seniorId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (out.Items ?? []).map((i) => ({
      incident_id: i.incident_id,
      kind: i.kind,
      status: i.status,
      severity: i.severity,
      title: i.title,
      opened_at: i.opened_at,
      updated_at: str(i.updated_at),
      closed_at: str(i.closed_at),
    }));
  }

  async recentAlerts(seniorId: string, limit: number): Promise<AlertRow[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.alerts,
        IndexName: "by_senior",
        KeyConditionExpression: "senior_id = :s",
        ExpressionAttributeValues: { ":s": seniorId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (out.Items ?? []).map(toAlert);
  }

  async incidentEvents(incidentId: string): Promise<EventRow[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.events,
        KeyConditionExpression: "incident_id = :i",
        // Contract events only: skips bookkeeping rows and raw sensor frames.
        FilterExpression: "attribute_exists(detail_type)",
        ExpressionAttributeValues: { ":i": incidentId },
        Limit: 200,
      }),
    );
    return (out.Items ?? []).map((e) => ({
      senior_id: String(e.senior_id),
      detail_type: String(e.detail_type),
      source: String(e.source),
      occurred_at: String(e.detail?.occurred_at ?? ""),
      detail: e.detail ?? {},
    }));
  }

  async getAlert(alertId: string): Promise<AlertRow | undefined> {
    const out = await this.doc.send(new GetCommand({ TableName: this.tables.alerts, Key: { alert_id: alertId } }));
    return out.Item ? toAlert(out.Item) : undefined;
  }
}

function toAlert(a: Record<string, unknown>): AlertRow {
  return {
    alert_id: String(a.alert_id),
    incident_id: String(a.incident_id),
    senior_id: String(a.senior_id),
    priority: String(a.priority ?? ""),
    title: String(a.title ?? ""),
    body: String(a.body ?? ""),
    status: String(a.status ?? "SENT"),
    created_at: String(a.created_at ?? ""),
    ack_action: str(a.ack_action),
  };
}
