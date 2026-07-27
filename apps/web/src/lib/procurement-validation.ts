import { z } from "zod";
export const procurementCreateSchema=z.record(z.string(),z.unknown()).refine(v=>Object.keys(v).length>0,"Provide Procurement data.");
export const procurementActionSchema=z.object({action:z.string().min(1).max(40)}).catchall(z.unknown());
