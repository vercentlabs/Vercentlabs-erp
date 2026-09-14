// Foundation checkpoint page, not a product screen. Replaced once the app
// shell (src/shell/app-shell) and a real landing surface exist — see
// docs/ux/UI_REWRITE_TRACKER.md for current phase status.
export default function WorkspaceRootPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-[640px] flex-col justify-center gap-3 px-6 py-16 text-text">
      <p className="text-sm font-medium text-text-muted">Vercentlabs ERP</p>
      <h1 className="text-2xl font-semibold text-text">
        Frontend rebuild in progress
      </h1>
      <p className="text-sm text-text-secondary">
        This is a clean-slate rebuild on Next.js, React Aria Components, and
        Tailwind v4. The application shell and module screens are being built
        module by module — see{" "}
        <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
          docs/ux/UI_REWRITE_TRACKER.md
        </code>{" "}
        for current status.
      </p>
    </main>
  );
}
