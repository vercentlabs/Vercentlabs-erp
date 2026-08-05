export type ManufacturingContext = {
  organizationId: string;
  companyId: string;
  userId: string;
  permissions: readonly string[];
};

export declare function getManufacturingDashboard(
  client: { query(...args: unknown[]): Promise<{ rows: any[] }> },
  context: ManufacturingContext,
): Promise<Record<string, unknown>>;

export declare function listManufacturingResource(
  client: { query(...args: unknown[]): Promise<{ rows: any[] }> },
  context: ManufacturingContext,
  resource: string,
  options?: { limit?: number; offset?: number },
): Promise<any[]>;

export declare function createBillOfMaterial(
  client: any,
  context: ManufacturingContext,
  input: Record<string, any>,
): Promise<any>;

export declare function activateBillOfMaterial(
  client: any,
  context: ManufacturingContext,
  bomId: string,
): Promise<any>;

export declare function createWorkOrder(
  client: any,
  context: ManufacturingContext,
  input: Record<string, any>,
): Promise<any>;

export declare function releaseWorkOrder(
  client: any,
  context: ManufacturingContext,
  workOrderId: string,
): Promise<any>;

export declare function startWorkOrder(
  client: any,
  context: ManufacturingContext,
  workOrderId: string,
): Promise<any>;

export declare function postProduction(
  client: any,
  context: ManufacturingContext,
  workOrderId: string,
  input: Record<string, any>,
): Promise<any>;
