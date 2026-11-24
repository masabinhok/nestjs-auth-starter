import { Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import bcrypt from 'bcryptjs';

export interface PasswordCheck {
  valid: boolean;
  /** Store a fresh hash: the stored one is bcrypt (v1) or has old parameters. */
  needsRehash: boolean;
}

const BCRYPT = /^\$2[aby]\$/;

/**
 * scrypt via @nestjs/authentication's PasswordHasher, plus verification of
 * the bcrypt hashes v1 stored, so upgraded users keep their passwords and
 * move to scrypt on their next sign-in.
 */
@Injectable()
export class PasswordsService {
  constructor(private readonly hasher: PasswordHasher) {}

  hash(password: string): Promise<string> {
    return this.hasher.hash(password);
  }

  /** Pass `null` for an unknown user: a dummy hash is checked, in the same time. */
  async verify(
    password: string,
    stored: string | null,
  ): Promise<PasswordCheck> {
    if (stored && BCRYPT.test(stored)) {
      const valid = await bcrypt.compare(password, stored);
      return { valid, needsRehash: valid };
    }
    const valid = await this.hasher.verify(password, stored);
    return {
      valid,
      needsRehash: valid && !!stored && this.hasher.needsRehash(stored),
    };
  }
}
