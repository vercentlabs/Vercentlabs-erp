// Scope-safe TanStack Query key convention. Every query key in this app must
// start with [organizationId] so that a sign-out's
// queryClient.removeQueries({ queryKey: [orgId] }) can never miss a scoped
// query, and so two organizations' cached responses can never collide under
// the same key.
export function scopedQueryKey(
  scope: { organizationId: string },
  ...rest: readonly unknown[]
) {
  return [scope.organizationId, ...rest] as const;
}
