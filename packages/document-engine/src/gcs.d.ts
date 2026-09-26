import type { ObjectStorage } from "./index";

export function createGcsObjectStorage(options: { bucket: string; prefix?: string; projectId?: string; apiEndpoint?: string; client?: unknown }): Promise<ObjectStorage>;
