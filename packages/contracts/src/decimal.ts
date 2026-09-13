import { z } from 'zod';

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

export type DecimalString = string & { readonly __brand: 'DecimalString' };

/**
 * Money and other exact-precision quantities must cross API boundaries as
 * decimal strings, never IEEE-754 numbers. See root governance rule 11.
 */
export function isDecimalString(value: string): value is DecimalString {
  return DECIMAL_STRING_PATTERN.test(value);
}

export function toDecimalString(value: string): DecimalString {
  if (!isDecimalString(value)) {
    throw new Error(`Invalid decimal string: "${value}"`);
  }
  return value;
}

export const decimalStringSchema = z
  .string()
  .regex(DECIMAL_STRING_PATTERN, 'must be a decimal string, e.g. "12.50"')
  .transform((value) => value as DecimalString);
