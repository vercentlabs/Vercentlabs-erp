export declare class DocumentNumberError extends Error {
  status: number;
  code: string;
}
export declare function nextDocumentNumber(
  client: any,
  context: { organizationId: string; companyId: string },
  options: { documentType: string; prefix: string; periodKey?: string; padding?: number },
): Promise<string>;
