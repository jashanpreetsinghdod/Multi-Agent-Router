export interface EncryptedKey {
  ciphertext: string;       // base64: nonce (12B) || ciphertext || auth tag (16B)
  dekWrapped: string;       // base64: wrapped DEK
  dekVersion: number;       // rotation generation
  keyLast4: string;         // last 4 chars of plaintext
  keyFingerprint: string;   // hex SHA-256 of plaintext
}

export function generateMasterKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function importMasterKey(hexKey: string): Promise<CryptoKey> {
  if (hexKey.length !== 64) {
    throw new Error('Master key must be exactly 64 hex characters (32 bytes / 256 bits)');
  }
  const bytes = new Uint8Array(
    hexKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)),
  );
  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function fingerprint(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function encryptKey(
  plaintext: string,
  masterKeyHex: string,
  version: number = 1,
): Promise<EncryptedKey> {
  const masterKey = await importMasterKey(masterKeyHex);

  // 1. Generate a random 256-bit DEK
  const dek = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can wrap it
    ['encrypt', 'decrypt'],
  );

  // 2. Encrypt the plaintext with DEK (AES-256-GCM)
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    dek,
    plaintextBytes,
  );

  // Pack nonce + ciphertext (Web Crypto appends auth tag to ciphertextBuffer)
  const packedCiphertext = new Uint8Array(nonce.length + ciphertextBuffer.byteLength);
  packedCiphertext.set(nonce, 0);
  packedCiphertext.set(new Uint8Array(ciphertextBuffer), nonce.length);

  // 3. Wrap DEK with Master Key (AES-256-GCM)
  const rawDek = await crypto.subtle.exportKey('raw', dek);
  const dekNonce = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDekBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: dekNonce },
    masterKey,
    rawDek,
  );

  const packedWrappedDek = new Uint8Array(dekNonce.length + wrappedDekBuffer.byteLength);
  packedWrappedDek.set(dekNonce, 0);
  packedWrappedDek.set(new Uint8Array(wrappedDekBuffer), dekNonce.length);

  // 4. Metadata
  const keyLast4 = plaintext.slice(-4);
  const keyFingerprint = await fingerprint(plaintext);

  return {
    ciphertext: Buffer.from(packedCiphertext).toString('base64'),
    dekWrapped: Buffer.from(packedWrappedDek).toString('base64'),
    dekVersion: version,
    keyLast4,
    keyFingerprint,
  };
}

export async function decryptKey(
  encrypted: Pick<EncryptedKey, 'ciphertext' | 'dekWrapped'>,
  masterKeyHex: string,
): Promise<string> {
  const masterKey = await importMasterKey(masterKeyHex);

  // 1. Unwrap DEK with Master Key
  const packedWrappedDek = Buffer.from(encrypted.dekWrapped, 'base64');
  const dekNonce = packedWrappedDek.subarray(0, 12);
  const wrappedDekCiphertext = packedWrappedDek.subarray(12);

  const rawDek = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: dekNonce },
    masterKey,
    wrappedDekCiphertext,
  );

  const dek = await crypto.subtle.importKey(
    'raw',
    rawDek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  // 2. Decrypt the plaintext with DEK
  const packedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
  const nonce = packedCiphertext.subarray(0, 12);
  const ciphertext = packedCiphertext.subarray(12);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    dek,
    ciphertext,
  );

  return new TextDecoder().decode(decryptedBuffer);
}

