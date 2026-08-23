import { procurementContext as buildContext } from "@vercentlabs/api";
import type { SessionContext } from "@/core/auth";
export function procurementContext(session: SessionContext){ return buildContext(session as unknown as Record<string,unknown>); }
