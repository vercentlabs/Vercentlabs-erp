import Link from "next/link";

import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { listRecentRecords } from "@/lib/recent-records";

export const metadata = { title: "Recent records" };
export const dynamic = "force-dynamic";

export default async function RecentRecordsPage() {
  const session = await requireWorkspace();
  const recent = await listRecentRecords(session, 30);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Continue where you left off</p>
          <h1>Recent records</h1>
          <p>
            The last records you opened, across every module you have access
            to. Access is re-checked every time this list loads.
          </p>
        </div>
      </section>
      {recent.length ? (
        <div className="stack-list">
          {recent.map((item) => (
            <Link href={item.href} key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.moduleKey || item.targetType}</span>
              </div>
              <small>
                {new Intl.DateTimeFormat("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(item.viewedAt))}
              </small>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <AppIcon name="check" size={22} />
          </span>
          <div>
            <strong>Nothing viewed yet</strong>
            <p>Records you open across CRM will start appearing here.</p>
          </div>
        </div>
      )}
    </>
  );
}
