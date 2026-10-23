import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { MessageSender, PendingPrompt, PromptTimer } from "@aegiscare/core";

/** SQS delay queue as a timer: the message comes back to the prompt handler after the delay. */
export class SqsPromptTimer implements PromptTimer {
  constructor(
    private readonly queueUrl: string,
    private readonly client = new SQSClient({}),
  ) {}

  async schedule(prompt: PendingPrompt, delaySeconds: number): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(prompt),
        // SQS caps message delay at 15 minutes.
        DelaySeconds: Math.max(0, Math.min(900, Math.round(delaySeconds))),
      }),
    );
  }
}

export interface SenderConfig {
  /** An AWS End User Messaging (SMS) phone number, pool or sender ID. Unset → no SMS. */
  smsOriginationIdentity?: string;
  /** A verified SES identity. Unset → no email. */
  fromEmail?: string;
}

export function awsMessageSender(config: SenderConfig): MessageSender {
  const sender: MessageSender = {};
  if (config.smsOriginationIdentity) {
    const sms = new PinpointSMSVoiceV2Client({});
    const origin = config.smsOriginationIdentity;
    sender.sms = async (to, text) => {
      await sms.send(
        new SendTextMessageCommand({ DestinationPhoneNumber: to, OriginationIdentity: origin, MessageBody: text, MessageType: "TRANSACTIONAL" }),
      );
    };
  }
  if (config.fromEmail) {
    const ses = new SESv2Client({});
    const from = config.fromEmail;
    sender.email = async (to, subject, text) => {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
        }),
      );
    };
  }
  return sender;
}
