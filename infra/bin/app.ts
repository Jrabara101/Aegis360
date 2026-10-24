import { App } from "aws-cdk-lib";
import { AegisCareStack } from "../lib/stack";

// cdk deploy -c foundationModel=<bedrock model or inference profile id>
//            -c notifyFromEmail=<verified SES identity>  -c smsOrigination=<End User Messaging number or pool>
//            -c promptTimeoutSeconds=90  -c iotDeviceId=esp32_hub_01
//            -c safeWordPromptArn=... -c notifyArn=... -c stateWriterArn=...   (replace a built-in target, optional)

const app = new App();
const ctx = (key: string) => (app.node.tryGetContext(key) as string | undefined) || undefined;

new AegisCareStack(app, "AegisCare360", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
  foundationModel: ctx("foundationModel"),
  demoSeniorIds: (ctx("demoSeniorIds") ?? "snr_demo_rosa").split(","),
  externalTargets: {
    safeWordPrompt: ctx("safeWordPromptArn"),
    notify: ctx("notifyArn"),
    stateWriter: ctx("stateWriterArn"),
  },
  notify: { fromEmail: ctx("notifyFromEmail"), smsOriginationIdentity: ctx("smsOrigination") },
  promptTimeoutSeconds: ctx("promptTimeoutSeconds") ? Number(ctx("promptTimeoutSeconds")) : undefined,
  iotDeviceId: ctx("iotDeviceId"),
  demoMode: ctx("demoMode") !== "false",
  destroyOnDelete: ctx("destroyOnDelete") === "true",
});
