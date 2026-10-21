import { newId } from "./ids";
import type { CommonDetail } from "./events";

export interface CommonInput {
  senior_id: string;
  incident_id: string;
  correlation_id: string;
  demo?: boolean;
  now?: Date;
}

/** The common block every event `detail` starts with (contracts doc, section 2). */
export function commonDetail(input: CommonInput): CommonDetail {
  return {
    schema_version: "1",
    event_id: newId("evt"),
    senior_id: input.senior_id,
    incident_id: input.incident_id,
    occurred_at: (input.now ?? new Date()).toISOString(),
    correlation_id: input.correlation_id,
    demo: input.demo ?? false,
  };
}
