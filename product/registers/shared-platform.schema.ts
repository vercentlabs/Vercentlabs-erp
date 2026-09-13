import { z } from 'zod';

/** The exact 36 shared-platform capability ids authorized for this register. Nothing else may appear. */
export const EXPECTED_CAPABILITY_IDS: readonly string[] = Array.from(
  { length: 36 },
  (_, index) => `SP${String(index + 1).padStart(3, '0')}`,
);

export const prioritySchema = z.enum(['P0', 'P1', 'P2']);

export const specificationStatusSchema = z.enum([
  'SPECIFICATION_READY',
  'SPECIFICATION_DRAFT',
  'SPECIFICATION_PENDING',
]);

export const implementationStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'IMPLEMENTED']);

export const productStatusSchema = z.enum(['NOT_READY', 'BETA', 'READY']);

export const capabilitySchema = z.object({
  id: z.string().regex(/^SP\d{3}$/, 'id must match SPnnn'),
  title: z.string().min(1, 'title is required'),
  priority: prioritySchema,
  specificationStatus: specificationStatusSchema,
  implementationStatus: implementationStatusSchema,
  productStatus: productStatusSchema,
  dependencies: z.array(z.string().regex(/^SP\d{3}$/, 'dependency id must match SPnnn')),
  evidencePaths: z.array(z.string().min(1)).min(1, 'evidencePaths must list at least one path'),
});

export const registerSchema = z.object({
  version: z.number().int().min(1),
  capabilities: z.array(capabilitySchema),
});

export type Capability = z.infer<typeof capabilitySchema>;
export type Register = z.infer<typeof registerSchema>;
