export declare const PERMISSIONS: Record<string, string>;
export declare function hasSessionPermission(session: any, permission: string): boolean;
export declare class PermissionDeniedError extends Error {
  status: number;
  code: string;
  permission: string;
}
export declare function requireSessionPermission(session: any, permission: string): any;
