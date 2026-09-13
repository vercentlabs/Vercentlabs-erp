import { loadApiEnv, type ApiEnv } from '@vercentlabs/configuration';

export const API_ENV = Symbol('API_ENV');

export const apiEnvProvider = {
  provide: API_ENV,
  useValue: loadApiEnv(),
};

export type { ApiEnv };
