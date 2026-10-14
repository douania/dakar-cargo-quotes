/** Identity of one authenticated IMAP account, independent of a UID or its folder. */
export function imapAccountSnapshot(config: {
  host: string; port: number; username: string; use_ssl: boolean;
}) {
  return { host: config.host, port: config.port, username: config.username, use_ssl: config.use_ssl };
}

export async function imapAccountKey(config: Parameters<typeof imapAccountSnapshot>[0]): Promise<string> {
  const account = imapAccountSnapshot(config);
  const bytes = new TextEncoder().encode(JSON.stringify([account.host, account.port, account.username, account.use_ssl]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

export interface ImportSearchIdentity {
  configId: string;
  mailbox: string;
  uidValidity: number;
  accountKey: string;
  messages: Array<{ uid: number; messageId: string }>;
}

export class ImportIdentityConflict extends Error {}

export function assertImportSearchIdentity(identity: ImportSearchIdentity | undefined, current: {
  configId: string; mailbox: string; uidValidity: number | null; accountKey: string;
}, uids: number[]): asserts identity is ImportSearchIdentity {
  if (!identity || identity.configId !== current.configId || identity.mailbox !== current.mailbox ||
      identity.accountKey !== current.accountKey || !Number.isSafeInteger(identity.uidValidity) ||
      identity.uidValidity <= 0 || identity.uidValidity !== current.uidValidity || !Array.isArray(identity.messages) ||
      identity.messages.length > 1000 || !identity.messages.every(m => m && Number.isSafeInteger(m.uid) && m.uid > 0)) {
    throw new ImportIdentityConflict('Identité de boîte modifiée ou absente. Relancez la recherche avant tout import.');
  }
  for (const uid of uids) {
    const matches = identity.messages.filter(m => m.uid === uid);
    if (matches.length !== 1 || !/^<[^<>\s]+>$/.test(matches[0].messageId) || /^<\d+@imported>$/.test(matches[0].messageId)) {
      throw new ImportIdentityConflict('Identité de message absente ou ambiguë. Aucun import effectué.');
    }
  }
}
