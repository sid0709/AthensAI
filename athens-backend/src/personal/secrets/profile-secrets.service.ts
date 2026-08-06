import { Injectable } from '@nestjs/common';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from '@nextoffer/shared/secretCrypto';
import {
  PROFILE_SECRET_FIELDS,
  type ProfileSecretField,
} from '../constants/profile-field.constants';
import { asText } from '../mappers/as-text';

/**
 * Encrypt/decrypt autoBidProfile secrets with local enc:v1: (API_KEYS_ENCRYPTION_KEY).
 */
@Injectable()
export class ProfileSecretsService {
  encryptProfile(profile: Record<string, unknown>): Record<string, unknown> {
    const out = { ...profile };
    for (const field of PROFILE_SECRET_FIELDS) {
      const value = out[field];
      if (typeof value === 'string' && value) {
        out[field] = this.encryptValue(value);
      }
    }
    return out;
  }

  decryptForClient(profile: Record<string, unknown>): {
    profile: Record<string, unknown>;
    unavailableFields: ProfileSecretField[];
  } {
    const out = { ...profile };
    const unavailableFields: ProfileSecretField[] = [];
    for (const field of PROFILE_SECRET_FIELDS) {
      const value = out[field];
      if (typeof value !== 'string' || !value) continue;
      try {
        out[field] = this.decryptValue(value);
      } catch {
        out[field] = '';
        unavailableFields.push(field);
      }
    }
    return { profile: out, unavailableFields };
  }

  /** Decrypt only selected secret fields; others cleared. */
  decryptSelected(
    profile: Record<string, unknown>,
    selectedFields: ProfileSecretField[],
  ): Record<string, unknown> {
    const selected = new Set(selectedFields);
    const out = { ...profile };
    for (const field of PROFILE_SECRET_FIELDS) {
      const value = out[field];
      if (typeof value !== 'string' || !value) continue;
      out[field] = selected.has(field) ? this.decryptValue(value) : '';
    }
    return out;
  }

  /** Keep ciphertext the client could not read unless it sent a replacement. */
  preserveUnavailable(
    profile: Record<string, unknown>,
    storedProfile: Record<string, unknown> | null | undefined,
    unavailableFields: ProfileSecretField[] = [],
  ): Record<string, unknown> {
    const out = { ...profile };
    for (const field of unavailableFields) {
      if (!out[field]) {
        out[field] = storedProfile?.[field] || '';
      }
    }
    return out;
  }

  private encryptValue(value: string): string {
    const text = asText(value);
    if (!text || isEncryptedSecret(text)) return text;
    return encryptSecret(text);
  }

  private decryptValue(value: string): string {
    const text = asText(value);
    if (!text) return '';
    return isEncryptedSecret(text) ? decryptSecret(text) : text;
  }
}
