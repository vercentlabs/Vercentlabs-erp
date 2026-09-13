import { z } from 'zod';

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, e.g. "2026-09-13"');
export type IsoDate = z.infer<typeof isoDateSchema>;

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const ianaTimeZoneSchema = z.string().refine(isValidIanaTimeZone, {
  message: 'must be a valid IANA time zone identifier, e.g. "Asia/Kolkata"',
});
export type IanaTimeZone = z.infer<typeof ianaTimeZoneSchema>;

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 currency code');
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;
