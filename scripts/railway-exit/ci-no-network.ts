// Imported before every Vitest suite. A mock may replace these locally; restoring
// the original restores a denial guard, never a live transport.
import http from 'node:http';
import https from 'node:https';
const denied = () => { throw new Error('LIVE_NETWORK_FORBIDDEN_IN_RAILWAY_EXIT_CI'); };
globalThis.fetch = async () => denied();
for (const module of [http, https]) for (const method of ['request', 'get']) Object.defineProperty(module, method, { value: denied, configurable: true, writable: true });
