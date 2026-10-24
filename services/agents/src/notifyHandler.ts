import {
  DETAIL_TYPES,
  parseDetail,
  type AlertDispatchDetail,
  type CaregiverContact,
  type ContactBook,
  type Delivery,
  type DeliveryLog,
  type MessageSender,
} from "@aegiscare/core";

// The notify target: Alert.Dispatch → SMS and email to each caregiver.
// There is no push service yet, so PUSH goes out as email, and SMS falls back to email
// when SMS isn't set up or the caregiver has no phone number.

export interface NotifyDeps {
  contacts: ContactBook;
  sender: MessageSender;
  deliveries: DeliveryLog;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function attempt(caregiverId: string, channel: Delivery["channel"], send: () => Promise<void>): Promise<Delivery> {
  try {
    await send();
    return { caregiver_id: caregiverId, channel, status: "SENT" };
  } catch (err) {
    return { caregiver_id: caregiverId, channel, status: "FAILED", detail: errorText(err).slice(0, 200) };
  }
}

async function deliverTo(alert: AlertDispatchDetail, contact: CaregiverContact, sender: MessageSender): Promise<Delivery[]> {
  const text = `AegisCare: ${alert.title}\n${alert.body}`;
  const wantsSms = alert.channels.includes("SMS");
  const sms = wantsSms && sender.sms && contact.phone ? sender.sms : undefined;
  const wantsEmail = alert.channels.includes("PUSH") || (wantsSms && !sms);
  const email = wantsEmail && sender.email && contact.email ? sender.email : undefined;

  const out: Delivery[] = [];
  if (sms) out.push(await attempt(contact.caregiver_id, "SMS", () => sms(contact.phone!, text)));
  if (email) out.push(await attempt(contact.caregiver_id, "EMAIL", () => email(contact.email!, `AegisCare: ${alert.title}`, text)));
  if (out.length === 0) {
    out.push({ caregiver_id: contact.caregiver_id, channel: wantsSms ? "SMS" : "EMAIL", status: "SKIPPED", detail: "no channel set up for this caregiver" });
  }
  return out;
}

/**
 * Sends one alert. Throws only when every attempt failed, so EventBridge retries without
 * sending anyone a second copy.
 */
export async function deliverAlert(raw: unknown, deps: NotifyDeps): Promise<Delivery[]> {
  const alert = parseDetail(DETAIL_TYPES.alertDispatch, raw);
  const contacts = await deps.contacts.getContacts(alert.recipients);
  const found = new Map(contacts.map((c) => [c.caregiver_id, c]));

  const deliveries = (
    await Promise.all(
      alert.recipients.map((id) => {
        const contact = found.get(id);
        if (!contact) return [{ caregiver_id: id, channel: "EMAIL", status: "SKIPPED", detail: "no caregiver record" } satisfies Delivery];
        return deliverTo(alert, contact, deps.sender);
      }),
    )
  ).flat();

  await deps.deliveries.record(alert.alert_id, deliveries);
  const sent = deliveries.filter((d) => d.status === "SENT").length;
  const failed = deliveries.filter((d) => d.status === "FAILED").length;
  deps.log?.("alert delivered", { alert_id: alert.alert_id, priority: alert.priority, sent, failed, skipped: deliveries.length - sent - failed });
  if (failed > 0 && sent === 0) throw new Error(`alert ${alert.alert_id}: all ${failed} deliveries failed`);
  return deliveries;
}
