import type { ObjectStorage } from "./index";

export function createGcsObjectStorage(options: { bucket: string; prefix?: string; projectId?: string; client?: unknown }): Promise<ObjectStorage>;
