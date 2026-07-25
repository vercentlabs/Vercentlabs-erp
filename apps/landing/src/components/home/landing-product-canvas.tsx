import {
  Activity,
  BadgeCheck,
  Building2,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  MoreHorizontal,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
} from "lucide-react";

const pipeline = [
  { label: "New", value: "24", accent: "bg-slate-400" },
  { label: "Qualified", value: "11", accent: "bg-indigo-500" },
  { label: "Proposal", value: "06", accent: "bg-teal-500" },
  { label: "Decision", value: "03", accent: "bg-emerald-500" },
];

const timeline = [
  { label: "Lead scored", meta: "Fit + intent", icon: Target },
  { label: "Owner assigned", meta: "West team", icon: UsersRound },
  { label: "Stage approved", meta: "Policy check", icon: BadgeCheck },
];

export default function LandingProductCanvas() {
  return (
    <div className="landing-canvas" aria-label="CRM workflow product preview">
      <div className="landing-canvas__chrome">
        <div className="flex items-center gap-2">
          <span className="landing-canvas__mark" aria-hidden="true">
            V
          </span>
          <div>
            <p className="text-[11px] font-extrabold text-slate-950 sm:text-xs">
              Revenue workspace
            </p>
            <p className="text-[9px] font-semibold text-slate-500 sm:text-[10px]">
              VercentLabs ERP · CRM
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="landing-live-chip">
            <span aria-hidden="true" /> Live controls
          </span>
          <button
            type="button"
            aria-label="More preview options"
            className="landing-icon-button"
          >
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="landing-canvas__body">
        <aside className="landing-canvas__rail" aria-label="Preview navigation">
          {[Activity, UsersRound, Building2, FileText].map((Icon, index) => (
            <span
              key={index}
              className={
                "landing-canvas__rail-icon " + (index === 0 ? "is-active" : "")
              }
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
            </span>
          ))}
        </aside>

        <div className="landing-canvas__workspace">
          <div className="landing-canvas__heading">
            <div>
              <p className="landing-kicker">Pipeline command view</p>
              <h2>From lead signal to governed decision.</h2>
            </div>
            <div className="landing-avatar-stack" aria-label="Assigned team">
              <span>AN</span>
              <span>PS</span>
              <span>+4</span>
            </div>
          </div>

          <div className="landing-pipeline" aria-label="Pipeline stages">
            {pipeline.map((stage, index) => (
              <div key={stage.label} className="landing-pipeline__stage">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[10px] font-extrabold text-slate-700 sm:text-xs">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${stage.accent}`}
                    />
                    {stage.label}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {stage.value}
                  </span>
                </div>

                <div
                  className={
                    "landing-deal-card " + (index === 1 ? "is-highlighted" : "")
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-extrabold text-slate-950 sm:text-xs">
                        Nova Industrial
                      </p>
                      <p className="mt-1 text-[9px] font-semibold text-slate-500 sm:text-[10px]">
                        Expansion opportunity
                      </p>
                    </div>
                    {index === 1 ? (
                      <Sparkles
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-indigo-600"
                      />
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[9px] font-extrabold text-slate-700 sm:text-[10px]">
                      ₹18.4L
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-extrabold text-slate-500 sm:text-[9px]">
                      {index === 1 ? "82 score" : "Follow-up"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="landing-canvas__lower-grid">
            <div className="landing-signal-card">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="landing-kicker">Control signal</p>
                  <p className="mt-1 text-xs font-extrabold text-slate-950 sm:text-sm">
                    Qualified stage change
                  </p>
                </div>
                <span className="landing-status-badge">
                  <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
                  Governed
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[
                  ["Permission", "Allowed"],
                  ["Approval", "Recorded"],
                  ["Audit", "Immutable"],
                ].map(([label, value]) => (
                  <div key={label} className="landing-mini-metric">
                    <p>{label}</p>
                    <strong>
                      <Check aria-hidden="true" className="h-3 w-3" />
                      {value}
                    </strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="landing-timeline-card">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-extrabold text-slate-950 sm:text-xs">
                  Activity timeline
                </p>
                <Clock3 aria-hidden="true" className="h-4 w-4 text-slate-400" />
              </div>
              <ol className="mt-3 grid gap-2.5">
                {timeline.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.label} className="flex items-center gap-2.5">
                      <span className="landing-timeline-icon">
                        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[9px] font-extrabold text-slate-800 sm:text-[10px]">
                          {item.label}
                        </span>
                        <span className="block truncate text-[8px] font-semibold text-slate-400 sm:text-[9px]">
                          {item.meta}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-slate-300"
                      />
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
