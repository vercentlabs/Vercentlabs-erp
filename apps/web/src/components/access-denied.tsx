import Link from "next/link";

export default function AccessDenied({
  area,
  returnHref = "/dashboard",
}: {
  area: string;
  returnHref?: string;
}) {
  return (
    <section className="panel empty-state" role="alert" aria-live="polite">
      <p className="eyebrow">Permission required</p>
      <h1>Access denied</h1>
      <p>
        Your current role cannot view {area}. Ask an organisation administrator
        to review your permissions if you need access.
      </p>
      <div className="form-actions">
        <Link className="primary-button" href={returnHref}>
          Return to dashboard
        </Link>
      </div>
    </section>
  );
}
