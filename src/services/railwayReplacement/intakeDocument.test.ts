import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileBytes, sha256Bytes } from './intakeDocument';

// Use the real native provider: a digest stub would hide the Node 20 realm bug.
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('document SHA-256 native WebCrypto realm compatibility', () => {
  it('hashes an actual foreign ArrayBuffer without changing its bytes', async () => {
    const bytes = vm.runInNewContext('new Uint8Array([97, 98, 99]).buffer') as ArrayBuffer;
    expect(bytes instanceof ArrayBuffer).toBe(false);
    expect(await sha256Bytes(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(Array.from(new Uint8Array(bytes))).toEqual([97, 98, 99]);
  });

  it('hashes the complete UTF-8 bytes returned by the real jsdom FileReader', async () => {
    const text = 'Dakar \u{1f69a} \u00e9\u0000tail';
    const file = new File([text], 'synthetic.txt', { type: 'text/plain' });
    const bytes = await readFileBytes(file);
    expect(bytes.byteLength).toBe(file.size);
    expect(await sha256Bytes(bytes)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
  });
});
