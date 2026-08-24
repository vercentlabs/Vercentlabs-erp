export class ConfigurationError extends Error { readonly issues: readonly string[]; constructor(issues: string[]); }
export const WORKSPACE_EMAILS: Readonly<{
  primary: "sales@vercentlabs.com";
  sales: "sales@vercentlabs.com";
  support: "support@vercentlabs.com";
  privacy: "privacy@vercentlabs.com";
  security: "security@vercentlabs.com";
  careers: "careers@vercentlabs.com";
  billing: "billing@vercentlabs.com";
  authentication: "auth@vercentlabs.com";
  operations: "operations@vercentlabs.com";
  dmarc: "dmarc@vercentlabs.com";
}>;
export function stringValue(environment: Record<string, string | undefined>, name: string, options?: { required?: boolean; minimumLength?: number; defaultValue?: string }): string;
export function integerValue(environment: Record<string, string | undefined>, name: string, options?: { defaultValue?: number; minimum?: number; maximum?: number }): number;
export function booleanValue(environment: Record<string, string | undefined>, name: string, defaultValue?: boolean): boolean;
export function originList(environment: Record<string, string | undefined>, name: string, options?: { required?: boolean; httpsOnly?: boolean }): string[];
export function databaseConfig(environment: Record<string, string | undefined>, options?: { name?: string; defaultPoolMaximum?: number }): Readonly<{ connectionString: string; poolMaximum: number; idleTimeoutMilliseconds: number; connectionTimeoutMilliseconds: number; statementTimeoutMilliseconds: number; queryTimeoutMilliseconds: number }>;
export function validateRuntimeEnvironment(target: "web" | "worker" | "landing" | "migration", environment?: Record<string, string | undefined>): Readonly<Record<string, unknown>>;
