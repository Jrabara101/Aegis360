/** Thrown by a classifier when the Bedrock guardrail blocked the input or output. */
export class GuardrailIntervenedError extends Error {
  override name = "GuardrailIntervenedError";
}

export interface AgentCallOptions {
  /** Total time budget for the model, across retries. */
  timeoutMs: number;
  maxAttempts: number;
  onModelError?: (err: unknown, attempt: number) => void;
}

/**
 * Asks a model and parses its reply, retrying a bad reply until the budget runs out.
 * Returns no output when the model fails, times out or the guardrail blocks it;
 * the caller then falls back to its deterministic score.
 */
export async function callAgent<T>(
  ask: (signal: AbortSignal) => Promise<string>,
  parse: (reply: string) => T,
  opts: AgentCallOptions,
): Promise<{ output?: T; guardrail: boolean }> {
  const deadline = Date.now() + opts.timeoutMs;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("agent call timed out")), remaining);
    try {
      const reply = await Promise.race([
        ask(controller.signal),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }),
        ),
      ]);
      return { output: parse(reply), guardrail: false };
    } catch (err) {
      opts.onModelError?.(err, attempt);
      if (err instanceof GuardrailIntervenedError) return { guardrail: true };
      if (controller.signal.aborted) break;
    } finally {
      clearTimeout(timer);
    }
  }
  return { guardrail: false };
}

/** Pulls the JSON object out of a model reply, tolerating code fences or a stray sentence around it. */
export function extractJson(text: string, onError: (message: string) => Error): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw onError("no JSON object in agent reply");
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch (err) {
    throw onError(`agent reply is not valid JSON: ${(err as Error).message}`);
  }
}
