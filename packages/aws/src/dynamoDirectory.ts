import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  SEVERITIES,
  incidentIdForSession,
  type CaregiverRecord,
  type IncidentSummary,
  type SeniorDirectory,
  type SeniorRecord,
  type SessionState,
  type Severity,
} from "@aegiscare/core";

// Table shapes: contracts doc, section 7.

export interface TableNames {
  seniors: string;
  caregivers: string;
  incidents: string;
  events: string;
}

const THIRTY_DAYS_S = 30 * 24 * 3600;

export class DynamoDirectory implements SeniorDirectory {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly tables: TableNames,
    client = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async getSenior(seniorId: string): Promise<SeniorRecord | undefined> {
    const out = await this.doc.send(new GetCommand({ TableName: this.tables.seniors, Key: { senior_id: seniorId } }));
    const item = out.Item;
    if (!item) return undefined;
    return {
      senior_id: item.senior_id,
      name: item.name,
      timezone: item.timezone ?? "UTC",
      status: item.status ?? "NORMAL",
      safe_word_hash: item.safe_word_hash ?? null,
      last_activity_at: item.last_activity_at ?? null,
    };
  }

  async listOpenIncidents(seniorId: string): Promise<IncidentSummary[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.incidents,
        KeyConditionExpression: "senior_id = :s",
        FilterExpression: "NOT (#st IN (:resolved, :closed))",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":s": seniorId, ":resolved": "RESOLVED", ":closed": "CLOSED" },
        ScanIndexForward: false,
        // The state writer reads this right after its own update.
        ConsistentRead: true,
      }),
    );
    return (out.Items ?? []).map((i) => ({
      incident_id: i.incident_id,
      kind: i.kind,
      status: i.status,
      severity: i.severity,
      title: i.title,
      opened_at: i.opened_at,
    }));
  }

  async listCaregivers(seniorId: string): Promise<CaregiverRecord[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.caregivers,
        IndexName: "by_senior",
        KeyConditionExpression: "senior_id = :s",
        ExpressionAttributeValues: { ":s": seniorId },
      }),
    );
    return (out.Items ?? []).map((c) => ({
      caregiver_id: c.caregiver_id,
      name: c.name,
      relationship: c.relationship ?? "family",
      priority: typeof c.priority === "number" ? c.priority : 1,
    }));
  }

  async incrementSafeWordAttempts(seniorId: string, sessionId: string): Promise<number> {
    // Lives in the Events table under the call's incident, so it expires with the call's events.
    const out = await this.doc.send(
      new UpdateCommand({
        TableName: this.tables.events,
        Key: { incident_id: incidentIdForSession(sessionId), "occurred_at#event_id": "safeword#attempts" },
        UpdateExpression: "ADD attempts :one SET senior_id = :s, #ttl = :ttl",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":s": seniorId, ":ttl": Math.floor(Date.now() / 1000) + THIRTY_DAYS_S },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(out.Attributes?.attempts ?? 1);
  }
}

/** Highest severity seen per call, kept beside the call's events. The conditional write makes it race-safe. */
export class DynamoSessionState implements SessionState {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly eventsTable: string,
    client = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client);
  }

  async raiseSeverity(sessionId: string, severity: Severity): Promise<boolean> {
    const rank = SEVERITIES.indexOf(severity);
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.eventsTable,
          Key: { incident_id: incidentIdForSession(sessionId), "occurred_at#event_id": "threat#highest" },
          UpdateExpression: "SET severity_rank = :r, #ttl = :ttl",
          ConditionExpression: "attribute_not_exists(severity_rank) OR severity_rank < :r",
          ExpressionAttributeNames: { "#ttl": "ttl" },
          ExpressionAttributeValues: { ":r": rank, ":ttl": Math.floor(Date.now() / 1000) + THIRTY_DAYS_S },
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }
}
