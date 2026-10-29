
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const hex = process.env.META_TOKEN_ENCRYPTION_KEY;

  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'META_TOKEN_ENCRYPTION_KEY must be 64 hex characters'
    );
  }

  return Buffer.from(hex, 'hex');
}

export function encryptToken(token: string): string {
  if (!token) {
    throw new Error('Cannot encrypt an empty token');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(
    ALGORITHM,
    getEncryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

export function decryptToken(payload: string): string {
  const parts = payload.split(':');

  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted token format');
  }

  const [, ivHex, tagHex, dataHex] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error('Invalid encrypted token metadata');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    iv
  );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
