import { loadWebEnv } from '@vercentlabs/configuration';

/** Fails fast at server startup if required web configuration is missing. */
export const webEnv = loadWebEnv();
