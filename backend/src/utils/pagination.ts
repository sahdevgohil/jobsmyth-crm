import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginationMeta(total: number, page: number, pageSize: number) {
  return { page, pageSize, total };
}

export function skipLimit(page: number, pageSize: number): { skip: number; limit: number } {
  return { skip: (page - 1) * pageSize, limit: pageSize };
}
