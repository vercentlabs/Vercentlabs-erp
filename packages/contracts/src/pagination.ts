import { z } from 'zod';

export const paginationRequestSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type PaginationRequest = z.infer<typeof paginationRequestSchema>;

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export function buildPaginatedResult<T>(
  items: T[],
  request: PaginationRequest,
  totalItems: number,
): PaginatedResult<T> {
  return {
    items,
    page: request.page,
    pageSize: request.pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / request.pageSize),
  };
}
