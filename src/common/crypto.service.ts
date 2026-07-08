/**
 * PHI FIELD ENCRYPTION — AES-256-GCM with versioned keys.
 * ─────────────────────────────────────────────────────────────────
 * Envelope design: in prod the data key is decrypted at boot via
 * KMS (key ARN + IAM role) and held only in memory. Key version is
 * stored beside every ciphertext so rotation = add key vN+1, write
 * new rows with it, lazily re-encrypt old rows.
 *
 * Ciphertext layout: [1B version][12B iv][16B authTag][...data]
 */
import { Injectable } from '@nestjs/common';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

@Injectable()
export class CryptoService {
  private keys = new Map<number, Buffer>();
  private currentVersion: number;

  constructor() {
    this.currentVersion = Number(process.env.PHI_KEY_VERSION ?? 1);
    const b64 = process.env.PHI_DATA_KEY_BASE64;
    if (!b64) throw new Error('PHI_DATA_KEY_BASE64 missing — refusing to start without PHI encryption');
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error('PHI data key must be 32 bytes (AES-256)');
    this.keys.set(this.currentVersion, key);
  }

  encrypt(plaintext: string): { ciphertext: Buffer; keyVersion: number } {
    const iv = randomBytes(12);
    const key = this.keys.get(this.currentVersion)!;
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const ciphertext = Buffer.concat([
      Buffer.from([this.currentVersion]), iv, cipher.getAuthTag(), data,
    ]);
    return { ciphertext, keyVersion: this.currentVersion };
  }

  decrypt(ciphertext: Buffer): string {
    const version = ciphertext[0];
    const key = this.keys.get(version);
    if (!key) throw new Error(`No PHI key for version ${version}`);
    const iv = ciphertext.subarray(1, 13);
    const tag = ciphertext.subarray(13, 29);
    const data = ciphertext.subarray(29);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  encryptJson(obj: unknown) { return this.encrypt(JSON.stringify(obj)); }
  decryptJson<T>(ct: Buffer): T { return JSON.parse(this.decrypt(ct)) as T; }
}
