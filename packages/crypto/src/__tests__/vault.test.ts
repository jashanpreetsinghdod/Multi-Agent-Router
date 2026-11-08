import { describe, expect, it } from 'vitest';
import {
  generateMasterKey,
  encryptKey,
  decryptKey,
  fingerprint,
} from '../vault.js';

describe('Envelope Encryption Vault', () => {
  it('generates a 64-hex-char master key', () => {
    const key = generateMasterKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(key)).toBe(true);
  });

  it('computes consistent sha-256 fingerprints', async () => {
    const rawKey = 'sk-ant-api03-test-1234567890';
    const fp1 = await fingerprint(rawKey);
    const fp2 = await fingerprint(rawKey);
    expect(fp1).toHaveLength(64);
    expect(fp1).toBe(fp2);

    const fpOther = await fingerprint('sk-ant-other');
    expect(fp1).not.toBe(fpOther);
  });

  it('encrypts and decrypts round-trip correctly', async () => {
    const masterKey = generateMasterKey();
    const rawKey = 'sk-proj-super-secret-key-1234';

    const encrypted = await encryptKey(rawKey, masterKey);

    expect(encrypted.keyLast4).toBe('1234');
    expect(encrypted.dekVersion).toBe(1);
    expect(encrypted.keyFingerprint).toHaveLength(64);
    expect(encrypted.ciphertext).not.toContain(rawKey);

    const decrypted = await decryptKey(encrypted, masterKey);
    expect(decrypted).toBe(rawKey);
  });

  it('fails decryption if master key is wrong', async () => {
    const masterKey1 = generateMasterKey();
    const masterKey2 = generateMasterKey();
    const rawKey = 'sk-proj-test';

    const encrypted = await encryptKey(rawKey, masterKey1);

    await expect(decryptKey(encrypted, masterKey2)).rejects.toThrow();
  });

  it('fails if ciphertext or wrapped dek is tampered with', async () => {
    const masterKey = generateMasterKey();
    const rawKey = 'sk-proj-tamper-test';

    const encrypted = await encryptKey(rawKey, masterKey);

    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from('tampered').toString('base64'),
    };

    await expect(decryptKey(tampered, masterKey)).rejects.toThrow();
  });
});

