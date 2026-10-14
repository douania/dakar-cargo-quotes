/** Server-only Vault access. No legacy plaintext fallback and no raw RPC errors. */
export interface MailboxSecretClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
}

export async function readMailboxSecret(client: MailboxSecretClient, configId: string): Promise<string> {
  try {
    const { data, error } = await client.rpc("read_mailbox_secret", { p_config_id: configId });
    if (error || typeof data !== "string" || data.length === 0) throw new Error();
    return data;
  } catch {
    throw new Error("Secret IMAP indisponible : configuration sécurisée requise");
  }
}

export async function createMailboxConfig(
  client: MailboxSecretClient,
  config: Record<string, unknown>,
  password: string,
): Promise<unknown> {
  try {
    const { data, error } = await client.rpc("create_mailbox_config", {
      p_config: config,
      p_password: password,
    });
    if (error || !data) throw new Error();
    return data;
  } catch {
    throw new Error("Enregistrement sécurisé de la configuration IMAP impossible");
  }
}

/** Rotate the reference atomically, without reading or updating the old secret. */
export async function replaceMailboxSecret(
  client: MailboxSecretClient,
  configId: unknown,
  password: unknown,
): Promise<void> {
  if (typeof configId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(configId)
    || typeof password !== "string" || password.length === 0 || password.length > 1024
    || password.includes("\r") || password.includes("\n") || password.includes(String.fromCharCode(0))) {
    throw new Error("Configuration ou mot de passe IMAP invalide");
  }
  try {
    const { error } = await client.rpc("replace_mailbox_secret", {
      p_config_id: configId, p_password: password,
    });
    if (error) throw new Error();
  } catch {
    throw new Error("Remplacement sécurisé du mot de passe IMAP impossible");
  }
}

/** IMAP quoted strings: prevent command injection, preserve literal credentials. */
export function quoteImapString(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Identifiant IMAP invalide");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
