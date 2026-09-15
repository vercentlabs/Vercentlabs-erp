// Scope-safe TanStack Query key convention (Phase 21). Every query key in
// this app must start with [organizationId, companyId] so that a context
// switch's queryClient.removeQueries({ queryKey: [oldOrgId] }) can never
// miss a scoped query, and so two different companies' cached responses
// can never collide under the same key.
export function scopedQueryKey(
  scope: { organizationId: string; companyId: string | null },
  ...rest: readonly unknown[]
) {
  return [
    scope.organizationId,
    scope.companyId ?? "no-company",
    ...rest,
  ] as const;
}
