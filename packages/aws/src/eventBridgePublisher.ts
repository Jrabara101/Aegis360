import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { parseDetail, type DetailFor, type DetailType, type EventPublisher, type Source } from "@aegiscare/core";

/** Publishes to AegisCareBus. Validates against the contracts first, so a bad payload fails here, not downstream. */
export class EventBridgePublisher implements EventPublisher {
  constructor(
    private readonly busName: string,
    private readonly client = new EventBridgeClient({}),
  ) {}

  async publish<T extends DetailType>(source: Source, detailType: T, detail: DetailFor<T>): Promise<void> {
    const valid = parseDetail(detailType, detail);
    const out = await this.client.send(
      new PutEventsCommand({
        Entries: [{ EventBusName: this.busName, Source: source, DetailType: detailType, Detail: JSON.stringify(valid) }],
      }),
    );
    if (out.FailedEntryCount) {
      const entry = out.Entries?.[0];
      throw new Error(`PutEvents failed for ${detailType}: ${entry?.ErrorCode} ${entry?.ErrorMessage}`);
    }
  }
}
