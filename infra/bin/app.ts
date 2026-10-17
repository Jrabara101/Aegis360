import { App } from "aws-cdk-lib";
import { AegisCareStack } from "../lib/stack";

// cdk deploy -c foundationModel=<bedrock model or inference profile id>
//            -c safeWordPromptArn=... -c notifyArn=... -c stateWriterArn=...   (teammates' Lambdas, optional)

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
  demoMode: ctx("demoMode") !== "false",
  destroyOnDelete: ctx("destroyOnDelete") === "true",
});
