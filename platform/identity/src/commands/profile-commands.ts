import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DomainNotFoundError, type MfaMethodsResponse, type UserDto } from '@vercentlabs/contracts';
import { withUserScope } from '@vercentlabs/database';
import { toUserDto, toWebAuthnCredentialDto } from '../mappers.js';
import { findPrimaryEmailForUser, findUserById } from '../repository/users.js';
import {
  countUnusedRecoveryCodes,
  findTotpCredential,
  listWebAuthnCredentials,
} from '../repository/credentials.js';

export async function getCurrentUser(db: NodePgDatabase, userId: string): Promise<UserDto> {
  return withUserScope(db, userId, async (tx) => {
    const user = await findUserById(tx, userId);
    if (!user) throw new DomainNotFoundError('User', userId);
    const email = await findPrimaryEmailForUser(tx, userId);
    return toUserDto(
      user,
      email ? { emailOriginal: email.emailOriginal, verifiedAt: email.verifiedAt } : undefined,
    );
  });
}

export async function getMfaMethods(
  db: NodePgDatabase,
  userId: string,
): Promise<MfaMethodsResponse> {
  return withUserScope(db, userId, async (tx) => {
    const [totp, webauthn, recoveryCodesRemaining] = await Promise.all([
      findTotpCredential(tx, userId),
      listWebAuthnCredentials(tx, userId),
      countUnusedRecoveryCodes(tx, userId),
    ]);
    return {
      totp: { confirmed: Boolean(totp?.confirmedAt) },
      webauthn: webauthn.map(toWebAuthnCredentialDto),
      recoveryCodesRemaining,
    };
  });
}
