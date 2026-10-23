import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { hashSafeWord } from "@aegiscare/core";
import { DEMO } from "../services/mcp-server/src/demoData";

// Loads the demo household into a deployed stack: Rosa, her caregivers Ana and Luis, and the
// family safe word, hashed with the stack's own pepper. Safe to run again; it overwrites.
//
//   npm run seed -- --ana-email you@example.com [--luis-email ...] [--ana-phone +1555...]
//
// Caregiver emails get the alert emails, and Ana's email is the caregiver web app sign-in.
// While SES is in sandbox mode, each address must be a verified SES identity.

const { values: args } = parseArgs({
  options: {
    "ana-email": { type: "string" },
    "luis-email": { type: "string" },
    "ana-phone": { type: "string" },
    stack: { type: "string", default: "AegisCare360" },
    region: { type: "string", default: process.env.AWS_REGION ?? "us-east-1" },
  },
});
if (!args["ana-email"]) throw new Error("Pass --ana-email: the address that gets alerts and signs in to the web app.");

/** Physical names of the stack's resources, by logical-ID prefix (CDK appends a hash). */
function stackResources(): Map<string, string> {
  const out = execFileSync(
    "aws",
    ["cloudformation", "describe-stack-resources", "--stack-name", args.stack!, "--region", args.region!, "--output", "json"],
    { encoding: "utf8" },
  );
  const { StackResources } = JSON.parse(out) as { StackResources: { LogicalResourceId: string; PhysicalResourceId: string }[] };
  return new Map(StackResources.map((r) => [r.LogicalResourceId, r.PhysicalResourceId]));
}

function find(resources: Map<string, string>, prefix: string): string {
  const matches = [...resources].filter(([logical]) => logical.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`Expected one resource starting with ${prefix}, found ${matches.length}`);
  return matches[0]![1];
}

const resources = stackResources();
const tables = {
  seniors: find(resources, "DataSeniors"),
  caregivers: find(resources, "DataCaregivers"),
};

const secrets = new SecretsManagerClient({ region: args.region });
const pepperArn = find(resources, "SafeWordPepper");
const pepper = (await secrets.send(new GetSecretValueCommand({ SecretId: pepperArn }))).SecretString;
if (!pepper) throw new Error("The safe-word pepper secret is empty");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: args.region }), {
  marshallOptions: { removeUndefinedValues: true },
});

await doc.send(
  new PutCommand({
    TableName: tables.seniors,
    Item: {
      senior_id: DEMO.seniorId,
      name: DEMO.seniorName,
      timezone: "America/Chicago",
      status: "NORMAL",
      safe_word_hash: hashSafeWord(DEMO.safeWord, pepper),
      last_activity_at: new Date().toISOString(),
    },
  }),
);

const contacts: Record<string, { email?: string; phone?: string }> = {
  cg_demo_ana: { email: args["ana-email"], phone: args["ana-phone"] },
  cg_demo_luis: { email: args["luis-email"] },
};
for (const caregiver of DEMO.caregivers) {
  await doc.send(
    new PutCommand({
      TableName: tables.caregivers,
      Item: { ...caregiver, senior_id: DEMO.seniorId, ...contacts[caregiver.caregiver_id] },
    }),
  );
}

console.log(`Seeded ${DEMO.seniorName} (${DEMO.seniorId}) with ${DEMO.caregivers.length} caregivers into ${args.stack}.`);
console.log(`Safe word: "${DEMO.safeWord}". Alerts go to ${[args["ana-email"], args["luis-email"]].filter(Boolean).join(" and ")}.`);
