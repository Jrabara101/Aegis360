import { RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table, TableEncryption } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

// Contracts doc, section 7. Teammate 3 owns these tables; they're defined here so the MCP
// server and agents can deploy before the IoT/data stack exists. Keep keys in sync with the doc.

export class DataTables extends Construct {
  readonly seniors: Table;
  readonly caregivers: Table;
  readonly trustedContacts: Table;
  readonly incidents: Table;
  readonly events: Table;
  readonly alerts: Table;

  constructor(scope: Construct, id: string, props: { removalPolicy?: RemovalPolicy } = {}) {
    super(scope, id);
    const common = {
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
    };
    const s = (name: string) => ({ name, type: AttributeType.STRING });

    this.seniors = new Table(this, "Seniors", { ...common, partitionKey: s("senior_id") });

    this.caregivers = new Table(this, "Caregivers", { ...common, partitionKey: s("caregiver_id") });
    this.caregivers.addGlobalSecondaryIndex({ indexName: "by_senior", partitionKey: s("senior_id") });

    this.trustedContacts = new Table(this, "TrustedContacts", { ...common, partitionKey: s("senior_id"), sortKey: s("contact_id") });
    this.trustedContacts.addGlobalSecondaryIndex({ indexName: "by_phone_hash", partitionKey: s("phone_hash") });

    this.incidents = new Table(this, "Incidents", { ...common, partitionKey: s("senior_id"), sortKey: s("opened_at#incident_id") });
    this.incidents.addGlobalSecondaryIndex({ indexName: "by_incident", partitionKey: s("incident_id") });
    this.incidents.addGlobalSecondaryIndex({ indexName: "by_status", partitionKey: s("status"), sortKey: s("opened_at#incident_id") });

    this.events = new Table(this, "Events", {
      ...common,
      partitionKey: s("incident_id"),
      sortKey: s("occurred_at#event_id"),
      timeToLiveAttribute: "ttl",
    });

    this.alerts = new Table(this, "Alerts", { ...common, partitionKey: s("alert_id") });
    this.alerts.addGlobalSecondaryIndex({ indexName: "by_incident", partitionKey: s("incident_id") });
  }
}
