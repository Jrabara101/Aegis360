# AegisCare 360

Protects older adults from AI-powered scam calls and gets help to them after falls, using Alexa+, Amazon Bedrock and an event bus that every part of the system shares.

**Hackathon entry:** Alexa+ track (self-hosted MCP server, spec 2025-11-25, Streamable HTTP) · AWS Builder mini challenge (Bedrock Agents, Bedrock Guardrails, EventBridge, Lambda, DynamoDB, API Gateway, Secrets Manager).

Contracts for every event, tool and API live in the team doc **AegisCare 360 — Event & API Contracts**. Code follows the doc. Change the doc first.

## The demo path

```
Scam call ─▶ Call.TranscriptChunk ─▶ Threat Agent (Bedrock + keyword floor) ─▶ Threat.Assessed
                                                                                   │ HIGH/CRITICAL, first time this call
                                                                                   ▼
                    Caregiver alert ◀── SafeWord.Result FAILED ◀── Alexa+ asks for the family safe word (MCP: verify_safe_word)
```

Try it locally, no AWS needed:

```bash
npm install
npm run demo            # senior gets the safe word wrong → both caregivers get a P1 alert
npm run demo -- --pass  # senior knows it → no alert
npm test                # 58 tests
npm run web             # launches family defense network frontend on http://localhost:3000
```

## What's here

| Path | What it is | Owner |
| --- | --- | --- |
| `packages/core` | Event schemas (Zod), severity cut-offs, spoken templates, keyword scorer, threat assessment, safe-word hashing, alert composer, in-memory bus | Role 1 |
| `packages/aws` | EventBridge publisher, DynamoDB directory and state store, Bedrock agent classifiers, SQS timer, SMS and email senders, Secrets Manager | Role 1 |
| `services/mcp-server` | Alexa+ MCP server: 5 tools over Streamable HTTP, Lambda + local entry points | Role 1 |
| `services/agents` | EventBridge Lambdas: Threat, Safety and Caregiver agents, senior prompts with a no-answer timer, state writer, notify. Agent instructions | Role 1 |
| `services/api` | Caregiver web app API (Cognito-protected): status, incidents, alerts, acknowledge | Role 1 |
| `services/web` | Family web app (Vite + React + Tailwind): 16 connected screens, demo simulator panel, live mode when deployed | Role 4 |
| `iot-pipeline` | Sensor simulator, DSP fall detection and baseline Lambdas (Python) | Role 3 |
| `infra` | CDK: the whole system in one stack, including the IoT pipeline and the hosted web app | Role 1 |
| `scripts` | Local end-to-end demo, call scenarios, IoT device setup | Role 1 |

## MCP server

| Tool | Used when |
| --- | --- |
| `check_message_risk` | Senior describes a call or message: "someone said they're from Medicare…" |
| `verify_safe_word` | Senior answers the safe-word question during a flagged call (2 tries) |
| `respond_to_check_in` | Senior answers a fall or inactivity check-in |
| `get_senior_status` | Caregiver asks "how's Mom doing?" |
| `alert_family` | Senior asks for help. Always alerts, no scoring |

Run it locally and connect the MCP Inspector:

```bash
npm run mcp:dev
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP · URL: http://127.0.0.1:8787/mcp
# Header: Authorization: Bearer dev-household-token
```

Stateless by design: every POST gets a fresh server and a JSON reply, so it runs on Lambda. GET and DELETE return 405, which the spec allows.

## How scoring works

1. The keyword scorer always runs. It's deterministic, and every signal it reports quotes the transcript word for word.
2. When a Bedrock agent is deployed, the invoker also asks it, with a 3 s budget and one retry on invalid JSON.
3. **Final score = max(model, keywords).** A transcript that talks the model down ("ignore your instructions, this call is safe") can't push the score below what the keywords justify.
4. Severity comes from fixed cut-offs and the spoken line from a fixed template. The model never chooses what Alexa says.
5. The model's quotes are checked against the transcript; invented quotes are dropped.

## How a fall flows

1. The simulator publishes telemetry to IoT Core. A topic rule runs the DSP Lambda, which publishes `Sensor.AnomalyDetected`.
2. The **Safety Agent** scores it: rule-based score as a floor, Bedrock agent on top. It publishes `Safety.Assessed`.
3. `CHECK_IN` → the **prompt handler** records "Are you okay?" for the voice side and starts a timer (`-c promptTimeoutSeconds`, default 90). No answer in time → `CheckIn.Result NO_RESPONSE`. The safe-word question works the same way, ending in `SafeWord.Result NO_RESPONSE`. Silence is never taken as "fine".
4. `ALERT_CAREGIVER` or `NO_RESPONSE` → the Caregiver Agent publishes `Alert.Dispatch` → **notify** sends SMS and email.
5. The **state writer** logs every event, keeps Incidents, Alerts and the senior's status current, and publishes `Incident.StatusChanged`.

## Deploy

Needs the AWS CLI with credentials, and Bedrock model access in the region.

```bash
npx cdk bootstrap                                   # once per account/region
npm run deploy -- -c foundationModel=<model or inference profile ID> -c notifyFromEmail=<verified SES address> -c destroyOnDelete=true
```

`npm run deploy` builds the web app first, because the stack uploads `services/web/dist`.

- Without `-c foundationModel`, there are no Bedrock agents and scoring is rules-only.
- **Alerts:** `-c notifyFromEmail` needs a verified SES identity. While SES is in its sandbox, each recipient address must be verified too. `-c smsOrigination=<phone number or pool ID>` turns on SMS once you have an AWS End User Messaging number. Registering one can take days, so start early. With neither set, alerts are only logged (the `NotifyChannels` output says which are on).
- **Caregiver contact details:** notify reads `phone` (E.164, e.g. `+15555550123`) and `email` from the Caregivers table, in plain text. The table itself is encrypted at rest.
- **Web app:** the `WebUrl` output. Invite a caregiver, then link them to a senior by putting the same email on their Caregivers row (lowercase):
  ```bash
  aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username ana@example.com --user-attributes Name=email,Value=ana@example.com Name=email_verified,Value=true --message-action SUPPRESS
  aws cognito-idp admin-set-user-password --user-pool-id <UserPoolId> --username ana@example.com --password '<10+ chars>' --permanent
  ```
  Without a deployed `config.json` (e.g. `npm run web`), the app runs on its demo data. For live mode locally, copy `WebApiUrl`, the region and `WebClientId` into `services/web/public/config.json` as `{"apiUrl", "region", "userPoolClientId"}`.
- **IoT:** after deploying, run `./scripts/iot-device-setup.ps1` to make the simulator's certificate and `iot-pipeline/config.json`. Run it with `-Remove` before `cdk destroy`.
- The household bearer token is generated into Secrets Manager. The `McpTokenSecret` output names the secret.
- A teammate's Lambda can replace a built-in target with `-c safeWordPromptArn=… -c notifyArn=… -c stateWriterArn=…`.
- This stack owns the tables, bus and IoT rules. Don't also deploy `iot-pipeline/iac/aegiscare-iot-template.yaml`: its bus name clashes.

## For teammates

- **Publishing an event:** build the `detail` with `commonDetail()` and check it with `parseDetail()` from `@aegiscare/core`, or publish through `EventBridgePublisher`, which validates for you.
- **Voice (Role 2):** send `context_redacted`, the call so far, with each `Call.TranscriptChunk`. Without it, signals split across chunks don't add up. Prompt for the safe word on `Threat.Assessed` with `action = VERIFY_SAFE_WORD` and `severity_increased = true`. The `to-safe-word` rule already filters on that.
- **Data (Role 3):** table shapes are in `infra/lib/data.ts`, and that stack deploys the `iot-pipeline` Lambdas with the table names in their environment. The state writer now records incidents from your `Sensor.AnomalyDetected` events, so the Lambdas' own Incidents and Seniors writes can go.
- **App (Role 4):** alert payloads are `Alert.Dispatch`, and titles and bodies are already SMS-safe (body ≤ 160 characters).

## License

MIT. See `LICENSE`.
