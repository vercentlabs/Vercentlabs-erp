import Link from "next/link";

export default function AnnouncementBar() {
  return (
    <div className="os-announcement" role="status">
      <span className="os-announcement__status">Release 01</span>
      <span>CRM early access is live.</span>
      <span className="os-announcement__divider" aria-hidden="true" />
      <Link href="/modules">See the transparent 12-module plan</Link>
    </div>
  );
}
