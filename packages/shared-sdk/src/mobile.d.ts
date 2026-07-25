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
  setAuthenticationFailureHandler(
    handler: ((error: VercentApiError) => void | Promise<void>) | null,
  ): () => void;
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
  workspace(): Promise<{
    session: MobileSession;
    shell: {
      organizations: Array<{ id: string; name: string }>;
      companies: Array<{ id: string; name: string }>;
      branches: Array<{ id: string; company_id: string; name: string }>;
      unreadNotifications: number;
    };
  }>;
  setWorkspaceContext(input: {
    companyId: string;
    branchId: string | null;
  }): Promise<{
    message: string;
    session: MobileSession;
    shell: {
      organizations: Array<{ id: string; name: string }>;
      companies: Array<{ id: string; name: string }>;
      branches: Array<{ id: string; company_id: string; name: string }>;
      unreadNotifications: number;
    };
  }>;
  setWorkspaceOrganization(input: { organizationId: string }): Promise<{
    message: string;
    session: MobileSession;
    shell: {
      organizations: Array<{ id: string; name: string }>;
      companies: Array<{ id: string; name: string }>;
      branches: Array<{ id: string; company_id: string; name: string }>;
      unreadNotifications: number;
    };
  }>;
  catalog(): Promise<{ catalog: MobileWorkspaceCatalog }>;
  health(): Promise<Record<string, unknown>>;
  crmDashboard(): Promise<{ dashboard: Record<string, unknown> }>;
  listCrm(
    resource: string,
    query?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<{ rows: Array<Record<string, unknown>>; total: number }>;
  getCrm(
    resource: string,
    id: string,
  ): Promise<{
    record: Record<string, unknown>;
    related?: Record<string, Array<Record<string, unknown>>>;
  }>;
  updateCrm(
    resource: string,
    id: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<{ record: Record<string, unknown>; message: string }>;
  createCrm(
    resource: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<{ record: Record<string, unknown>; message: string }>;
  completeActivity(
    id: string,
    outcome?: string,
    idempotencyKey?: string,
  ): Promise<{ record: Record<string, unknown>; message: string }>;
  moveOpportunity(
    id: string,
    stageId: string,
    note?: string,
    idempotencyKey?: string,
  ): Promise<{ record: Record<string, unknown>; message: string }>;
  createApprovalRequest(
    commandKey: string,
    commandPayload: Record<string, unknown>,
    assignedTo?: string | null,
    idempotencyKey?: string,
  ): Promise<{ id: string; message: string }>;
  search(query: string): Promise<{
    results: Array<{
      resource: string;
      record: Record<string, unknown>;
      title: string;
      subtitle: string;
      href: string;
    }>;
  }>;
  notifications(): Promise<{
    notifications: Array<{
      id: string;
      title: string;
      message: string;
      href: string | null;
      readAt: string | null;
      createdAt: string;
    }>;
  }>;
  markNotifications(input: {
    id?: string;
    all?: boolean;
  }): Promise<{ message: string }>;
  listWorkspaceResource<T = Record<string, unknown>>(
    area: "crm" | "business-data" | "settings",
    resource: string,
    query?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<T>;
  createWorkspaceResource<T = Record<string, unknown>>(
    area: "crm" | "business-data" | "settings",
    resource: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T>;
  updateWorkspaceResource<T = Record<string, unknown>>(
    area: "crm" | "business-data" | "settings",
    resource: string,
    id: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T>;
  archiveWorkspaceResource<T = Record<string, unknown>>(
    area: "crm" | "business-data",
    resource: string,
    id: string,
    idempotencyKey?: string,
  ): Promise<T>;
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
  apiRequest<T = Record<string, unknown>>(
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

export type MobileFieldDefinition = {
  name: string;
  label: string;
  type:
    | "text"
    | "email"
    | "number"
    | "date"
    | "datetime-local"
    | "select"
    | "checkbox"
    | "textarea";
  structuredKind?: "list" | "key-value" | "actions" | "schedule" | "value";
  structuredOptionsKey?: string;
  helpText?: string;
  required?: boolean;
  optionsKey?: string;
  options?: Array<{ value: string; label: string }>;
};

export type MobileResourceDefinition = {
  key: string;
  title: string;
  singular?: string;
  eyebrow?: string;
  description: string;
  group?: string;
  permission?: string;
  managePermission?: string;
  fields: MobileFieldDefinition[];
  columns?: Array<{
    key: string;
    label: string;
    optionsKey?: string;
    format?: string;
  }>;
};

export type MobileWorkspaceCatalog = {
  crm: MobileResourceDefinition[];
  masterData: MobileResourceDefinition[];
  masterDataGroups: Array<{ name: string; title: string; description: string }>;
  masterDataOverview: Record<string, number>;
  settings: MobileResourceDefinition[];
  modules: Array<{
    key: string;
    name: string;
    description: string;
    availability: string;
  }>;
};

export function createMobileClient(options: {
  baseUrl: string;
  tokenStore: MobileTokenStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  clientVersion?: string;
  requestIdFactory?: () => string;
}): MobileClient;
