import { z } from 'zod';

export const sortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

export const sortPrimitiveSchema = z.object({
  field: z.string().min(1),
  direction: sortDirectionSchema,
});
export type SortPrimitive = z.infer<typeof sortPrimitiveSchema>;

export const filterOperatorSchema = z.enum([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'isNull',
  'isNotNull',
]);
export type FilterOperator = z.infer<typeof filterOperatorSchema>;

export const filterPrimitiveSchema = z.object({
  field: z.string().min(1),
  operator: filterOperatorSchema,
  value: z.unknown().optional(),
});
export type FilterPrimitive = z.infer<typeof filterPrimitiveSchema>;

/** Parses a `sort=field:asc,otherField:desc` query parameter into sort primitives. */
export function parseSortParam(raw: string | undefined): SortPrimitive[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [field, direction = 'asc'] = entry.split(':');
      return sortPrimitiveSchema.parse({ field, direction });
    });
}
