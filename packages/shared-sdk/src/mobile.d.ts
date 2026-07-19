export type MobileTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
};

export type MobileTokenStore = {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(tokens: MobileTokens): Promise<void>;
  clear(): Promise<void>;
};

export type MobileSession = {
  user: {
    id: string;
    email: string;
    fullName: string;
    locale: string;
    timezone: string;
  };
  workspace: {
    organizationId: string | null;
    organizationName: string | null;
    membershipRole: "owner" | "admin" | "member" | null;
    activeCompanyId: string | null;
    companyName: string | null;
    activeBranchId: string | null;
    branchName: string | null;
  };
  access: { roleSlugs: string[]; permissions: string[] };
};

export type MobileAuthResponse = MobileTokens & { session: MobileSession };

export class VercentApiError extends Error {
  status: number;
  code: string;
  requestId: string | null;
  details: unknown;
  retryable: boolean;
}

export function createMemoryTokenStore(
  initial?: MobileTokens | null,
): MobileTokenStore;

export type MobileClient = {
  login(input: {
    email: string;
    password: string;
    device: {
      deviceId: string;
      platform: "android" | "ios";
      deviceName: string;
      appVersion: string;
    };
  }): Promise<MobileAuthResponse>;
  refresh(): Promise<MobileAuthResponse>;
  logout(): Promise<Record<string, unknown>>;
  session(): Promise<{ session: MobileSession }>;
  health(): Promise<Record<string, unknown>>;
  crmDashboard(): Promise<{ dashboard: Record<string, unknown> }>;
  listCrm(
    resource: "leads" | "opportunities" | "activities" | "pipeline-stages",
    query?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<{ rows: Array<Record<string, unknown>>; total: number }>;
  createCrm(resource: "leads" | "opportunities" | "activities", input: Record<string, unknown>, idempotencyKey?: string): Promise<{ record: Record<string, unknown>; message: string }>;
  completeActivity(id: string, outcome?: string, idempotencyKey?: string): Promise<{ record: Record<string, unknown>; message: string }>;
  moveOpportunity(id: string, stageId: string, note?: string, idempotencyKey?: string): Promise<{ record: Record<string, unknown>; message: string }>;
  request<T = Record<string, unknown>>(
    path: string,
    init?: RequestInit,
    options?: {
      authenticated?: boolean;
      retryAfterRefresh?: boolean;
      idempotencyKey?: string;
      requestId?: string;
    },
  ): Promise<T>;
};

export function createMobileClient(options: {
  baseUrl: string;
  tokenStore: MobileTokenStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  clientVersion?: string;
  requestIdFactory?: () => string;
}): MobileClient;
