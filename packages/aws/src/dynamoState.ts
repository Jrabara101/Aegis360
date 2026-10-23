import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, type BatchGetCommandOutput, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  SEVERITIES,
  type AlertAcknowledgedDetail,
  type AlertDispatchDetail,
  type CaregiverContact,
  type ContactBook,
  type Delivery,
  type DeliveryLog,
  type IncidentStatus,
  type IncidentUpdate,
  type PendingPrompt,
  type PromptStore,
  type SeniorStatus,
  type StateStore,
  type StoredEvent,
} from "@aegiscare/core";

// Write side of the tables in contracts doc section 7. Bookkeeping rows live in the Events
// table under the incident, with sort keys that start with a letter so they never collide
// with "<occurred_at>#<event_id>".

const THIRTY_DAYS_S = 30 * 24 * 3600;
const ttl = () => Math.floor(Date.now() / 1000) + THIRTY_DAYS_S;
const SK = "occurred_at#event_id";
const docClient = (client: DynamoDBClient) => DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

export interface StateTableNames {
  seniors: string;
  incidents: string;
  events: string;
  alerts: string;
}

export class DynamoStateStore implements StateStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly tables: StateTableNames,
    client = new DynamoDBClient({}),
  ) {
    this.doc = docClient(client);
  }

  async recordEvent(event: StoredEvent): Promise<void> {
    const d = event.detail;
    await this.doc.send(
      new PutCommand({
        TableName: this.tables.events,
        Item: {
          incident_id: d.incident_id,
          [SK]: `${d.occurred_at}#${d.event_id}`,
          senior_id: d.senior_id,
          detail_type: event.detailType,
          source: event.source,
          detail: d,
          ttl: ttl(),
        },
      }),
    );
  }

  /** The incident's opening time, fixed by whichever event arrives first. It's part of the Incidents sort key. */
  private async openedAt(update: IncidentUpdate): Promise<string> {
    const key = { incident_id: update.incident_id, [SK]: "incident#meta" };
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tables.events,
          Item: { ...key, senior_id: update.senior_id, opened_at: update.occurred_at },
          ConditionExpression: "attribute_not_exists(incident_id)",
        }),
      );
      return update.occurred_at;
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
      const out = await this.doc.send(new GetCommand({ TableName: this.tables.events, Key: key, ConsistentRead: true }));
      return String(out.Item?.opened_at ?? update.occurred_at);
    }
  }

  async upsertIncident(update: IncidentUpdate): Promise<{ from: IncidentStatus | null; to: IncidentStatus }> {
    const openedAt = await this.openedAt(update);
    const key = { senior_id: update.senior_id, "opened_at#incident_id": `${openedAt}#${update.incident_id}` };
    const existing = (await this.doc.send(new GetCommand({ TableName: this.tables.incidents, Key: key, ConsistentRead: true }))).Item;

    const from = (existing?.status as IncidentStatus | undefined) ?? null;
    const to = update.status ?? from ?? "OPEN";
    const oldRank = SEVERITIES.indexOf(existing?.severity);
    const severity = SEVERITIES.indexOf(update.severity) > oldRank ? update.severity : (existing?.severity ?? update.severity);
    const closed = to === "RESOLVED" || to === "CLOSED";

    await this.doc.send(
      new UpdateCommand({
        TableName: this.tables.incidents,
        Key: key,
        UpdateExpression:
          "SET incident_id = :id, opened_at = :opened, kind = if_not_exists(kind, :kind), title = if_not_exists(title, :title), " +
          `severity = :sev, #st = :st, updated_at = :now${closed ? ", closed_at = if_not_exists(closed_at, :now)" : ""}`,
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":id": update.incident_id,
          ":opened": openedAt,
          ":kind": update.kind,
          ":title": update.title,
          ":sev": severity,
          ":st": to,
          ":now": update.occurred_at,
        },
      }),
    );
    return { from, to };
  }

  async recordAlert(alert: AlertDispatchDetail): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tables.alerts,
        Key: { alert_id: alert.alert_id },
        UpdateExpression:
          "SET incident_id = :inc, senior_id = :snr, priority = :p, title = :t, body = :b, recipients = :r, channels = :c, " +
          "requires_ack = :ra, ack_deadline = :ad, created_at = :at, #st = if_not_exists(#st, :sent)",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":inc": alert.incident_id,
          ":snr": alert.senior_id,
          ":p": alert.priority,
          ":t": alert.title,
          ":b": alert.body,
          ":r": alert.recipients,
          ":c": alert.channels,
          ":ra": alert.requires_ack,
          ":ad": alert.ack_deadline,
          ":at": alert.occurred_at,
          ":sent": "SENT",
        },
      }),
    );
  }

  async acknowledgeAlert(ack: AlertAcknowledgedDetail): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tables.alerts,
        Key: { alert_id: ack.alert_id },
        UpdateExpression: "SET #st = :st, ack_action = :a, acknowledged_by = :by, acknowledged_at = :at, incident_id = :inc, senior_id = :snr",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":st": "ACKNOWLEDGED",
          ":a": ack.action,
          ":by": ack.caregiver_id,
          ":at": ack.occurred_at,
          ":inc": ack.incident_id,
          ":snr": ack.senior_id,
        },
      }),
    );
  }

  async setSeniorStatus(seniorId: string, status: SeniorStatus, lastActivityAt: string | null): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tables.seniors,
          Key: { senior_id: seniorId },
          UpdateExpression: `SET #st = :st${lastActivityAt ? ", last_activity_at = :la" : ""}`,
          // Never create a bare senior record from an event about an unknown ID.
          ConditionExpression: "attribute_exists(senior_id)",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: { ":st": status, ...(lastActivityAt ? { ":la": lastActivityAt } : {}) },
        }),
      );
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
    }
  }
}

const ANSWER_TYPES = { SAFE_WORD: "SafeWord.Result", CHECK_IN: "CheckIn.Result" } as const;

export class DynamoPromptStore implements PromptStore {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly eventsTable: string,
    client = new DynamoDBClient({}),
  ) {
    this.doc = docClient(client);
  }

  async recordPending(prompt: PendingPrompt, say: string): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.eventsTable,
        Item: { ...prompt, [SK]: `prompt#${prompt.kind}`, say, ttl: ttl() },
      }),
    );
  }

  async answerStatus(prompt: PendingPrompt): Promise<{ answered: boolean; attempts: number }> {
    // The state writer logs every event under its incident, so the answer is there if it came.
    let answered = false;
    let startKey: Record<string, unknown> | undefined;
    do {
      const out = await this.doc.send(
        new QueryCommand({
          TableName: this.eventsTable,
          KeyConditionExpression: "incident_id = :i AND #sk > :asked",
          FilterExpression: "detail_type = :t",
          ExpressionAttributeNames: { "#sk": SK },
          ExpressionAttributeValues: { ":i": prompt.incident_id, ":asked": prompt.asked_at, ":t": ANSWER_TYPES[prompt.kind] },
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        }),
      );
      answered = (out.Items?.length ?? 0) > 0;
      startKey = out.LastEvaluatedKey;
    } while (!answered && startKey);

    let attempts = 0;
    if (prompt.kind === "SAFE_WORD") {
      const out = await this.doc.send(
        new GetCommand({ TableName: this.eventsTable, Key: { incident_id: prompt.incident_id, [SK]: "safeword#attempts" }, ConsistentRead: true }),
      );
      attempts = Number(out.Item?.attempts ?? 0);
    }
    return { answered, attempts };
  }
}

export class DynamoContactBook implements ContactBook {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly caregiversTable: string,
    client = new DynamoDBClient({}),
  ) {
    this.doc = docClient(client);
  }

  async getContacts(caregiverIds: readonly string[]): Promise<CaregiverContact[]> {
    const items: Record<string, unknown>[] = [];
    let keys: Record<string, unknown>[] | undefined = [...new Set(caregiverIds)].map((caregiver_id) => ({ caregiver_id }));
    // A handful of caregivers per senior, well under BatchGet's 100-key limit.
    for (let round = 0; keys?.length && round < 3; round++) {
      const out: BatchGetCommandOutput = await this.doc.send(new BatchGetCommand({ RequestItems: { [this.caregiversTable]: { Keys: keys } } }));
      items.push(...(out.Responses?.[this.caregiversTable] ?? []));
      keys = out.UnprocessedKeys?.[this.caregiversTable]?.Keys;
    }
    return items.map((c) => ({
      caregiver_id: String(c.caregiver_id),
      name: String(c.name ?? ""),
      phone: typeof c.phone === "string" && c.phone ? c.phone : null,
      email: typeof c.email === "string" && c.email ? c.email : null,
    }));
  }
}

export class DynamoDeliveryLog implements DeliveryLog {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly alertsTable: string,
    client = new DynamoDBClient({}),
  ) {
    this.doc = docClient(client);
  }

  async record(alertId: string, deliveries: Delivery[]): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.alertsTable,
        Key: { alert_id: alertId },
        UpdateExpression: "SET deliveries = :d, delivered_at = :at",
        ExpressionAttributeValues: { ":d": deliveries, ":at": new Date().toISOString() },
      }),
    );
  }
}
