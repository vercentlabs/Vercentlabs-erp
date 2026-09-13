/**
 * Email delivery abstraction. SP018 (the full transactional-email
 * platform) remains NOT_STARTED - this is the minimum seam SP004/SP005/
 * SP007 need to send verification/reset/invitation links without
 * inventing a parallel, un-abstracted delivery mechanism that SP018 would
 * later have to replace wholesale.
 *
 * `rawToken` is passed here, never logged - see
 * docs/operations/account-recovery.md for the exact rule ("never log
 * complete verification/reset URLs containing live tokens"). Providers
 * must not log it either; `FailClosedEmailProvider` and
 * `InMemoryEmailProvider` both honor this.
 */
export interface EmailSendRequest {
  templateId: 'EMAIL_VERIFY' | 'EMAIL_CHANGE' | 'PASSWORD_RESET' | 'INVITATION';
  to: string;
  rawToken: string;
}

export interface EmailProvider {
  send(request: EmailSendRequest): Promise<void>;
}

/**
 * Production default when no real provider is configured. Throws rather
 * than silently succeeding - "normal development must not silently treat
 * emails as delivered" applies equally to production misconfiguration:
 * failing loudly here is strictly better than a user waiting forever for
 * an email that was quietly discarded.
 */
export class FailClosedEmailProvider implements EmailProvider {
  async send(): Promise<void> {
    throw new Error(
      'No email provider is configured. Set up a real EmailProvider before this deployment can send verification/reset/invitation emails.',
    );
  }
}

/** Test-only: captures sends in memory so tests can assert on them without a real mail transport, and without ever logging the token. */
export class InMemoryEmailProvider implements EmailProvider {
  public readonly sent: EmailSendRequest[] = [];

  async send(request: EmailSendRequest): Promise<void> {
    this.sent.push(request);
  }

  lastSentTo(to: string): EmailSendRequest | undefined {
    return [...this.sent].reverse().find((entry) => entry.to === to);
  }
}
