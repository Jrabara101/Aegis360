import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const cache = new Map<string, Promise<string>>();
const client = new SecretsManagerClient({});

/** Reads a secret once per Lambda container. */
export function getSecret(secretId: string): Promise<string> {
  let value = cache.get(secretId);
  if (!value) {
    value = client.send(new GetSecretValueCommand({ SecretId: secretId })).then((out) => {
      if (!out.SecretString) throw new Error(`secret ${secretId} has no string value`);
      return out.SecretString;
    });
    value.catch(() => cache.delete(secretId));
    cache.set(secretId, value);
  }
  return value;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}
