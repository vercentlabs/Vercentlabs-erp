export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[45vh] items-center justify-center bg-white sm:min-h-[55vh]"
    >
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />

        <p className="mt-4 text-sm font-bold text-slate-600">
          Loading VercentLabs ERP...
        </p>
      </div>
    </div>
  );
}
