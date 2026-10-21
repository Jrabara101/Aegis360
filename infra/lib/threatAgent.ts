import { readFileSync } from "node:fs";
import { Aws, Stack } from "aws-cdk-lib";
import { CfnAgent, CfnAgentAlias, CfnGuardrail, CfnGuardrailVersion } from "aws-cdk-lib/aws-bedrock";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

// Must match GUARDRAIL_BLOCKED_MARKER in packages/aws/src/bedrockAgentClassifier.ts.
const BLOCKED = "AEGIS_GUARDRAIL_BLOCKED";

/** AegisCareGuardrail (contracts doc, section 5). Shared by every agent. */
export class AegisGuardrail extends Construct {
  readonly guardrail: CfnGuardrail;
  readonly version: CfnGuardrailVersion;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.guardrail = new CfnGuardrail(this, "Guardrail", {
      name: "AegisCareGuardrail",
      description: "Blocks prompt injection from call transcripts, masks personal data, and stops payment instructions in agent output.",
      blockedInputMessaging: BLOCKED,
      blockedOutputsMessaging: BLOCKED,
      contentPolicyConfig: {
        filtersConfig: [
          // Transcripts are untrusted: a caller saying "ignore your instructions" is blocked,
          // and the invoker falls back to the keyword scorer with guardrail_intervened = true.
          { type: "PROMPT_ATTACK", inputStrength: "HIGH", outputStrength: "NONE" },
          { type: "MISCONDUCT", inputStrength: "NONE", outputStrength: "MEDIUM" },
        ],
      },
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: ["PHONE", "CREDIT_DEBIT_CARD_NUMBER", "US_SOCIAL_SECURITY_NUMBER", "US_BANK_ACCOUNT_NUMBER", "PIN", "PASSWORD"].map(
          (type) => ({ type, action: "ANONYMIZE", inputEnabled: true, inputAction: "ANONYMIZE", outputEnabled: true, outputAction: "ANONYMIZE" }),
        ),
      },
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: "PaymentInstructions",
            type: "DENY",
            definition: "Telling someone how to send money, buy or read out gift cards, use cryptocurrency, or share passwords, PINs or account codes.",
            examples: ["Buy three Google Play cards and read me the numbers.", "Go to the bitcoin ATM and scan this code."],
            // Output only: scam transcripts are full of payment talk and must reach the agent.
            inputEnabled: false,
            outputEnabled: true,
          },
        ],
      },
    });
    this.version = new CfnGuardrailVersion(this, "Version", {
      guardrailIdentifier: this.guardrail.attrGuardrailId,
      description: "v0.1",
    });
  }
}

export interface ThreatAgentProps {
  foundationModel: string;
  instructionsPath: string;
  guardrail: AegisGuardrail;
}

/** Inbound Threat Agent: instructions + guardrail, no action groups yet (the invoker passes the context it needs). */
export class ThreatAgent extends Construct {
  readonly agent: CfnAgent;
  readonly alias: CfnAgentAlias;

  constructor(scope: Construct, id: string, props: ThreatAgentProps) {
    super(scope, id);
    const stack = Stack.of(this);

    const role = new Role(this, "Role", {
      assumedBy: new ServicePrincipal("bedrock.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID },
          ArnLike: { "aws:SourceArn": `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:agent/*` },
        },
      }),
    });
    role.addToPolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:GetInferenceProfile"],
        resources: [
          `arn:${Aws.PARTITION}:bedrock:*::foundation-model/*`,
          stack.formatArn({ service: "bedrock", resource: "inference-profile", resourceName: "*" }),
        ],
      }),
    );
    role.addToPolicy(new PolicyStatement({ actions: ["bedrock:ApplyGuardrail"], resources: [props.guardrail.guardrail.attrGuardrailArn] }));

    this.agent = new CfnAgent(this, "Agent", {
      agentName: "AegisCareThreatAgent",
      description: "Scores live call transcripts for scam risk. Returns JSON only.",
      foundationModel: props.foundationModel,
      instruction: readFileSync(props.instructionsPath, "utf8"),
      agentResourceRoleArn: role.roleArn,
      idleSessionTtlInSeconds: 600,
      autoPrepare: true,
      guardrailConfiguration: {
        guardrailIdentifier: props.guardrail.guardrail.attrGuardrailId,
        guardrailVersion: props.guardrail.version.attrVersion,
      },
    });

    this.alias = new CfnAgentAlias(this, "Alias", { agentId: this.agent.attrAgentId, agentAliasName: "live" });
  }
}
