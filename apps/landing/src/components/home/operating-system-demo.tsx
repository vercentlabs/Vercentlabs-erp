"use client";

import {
  Activity,
  Building2,
  Check,
  CircleDot,
  Clock3,
  FileCheck2,
  Filter,
  LayoutDashboard,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  X,
} from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";

type DemoView = "inbox" | "pipeline" | "approval";
type ApprovalDecision = "pending" | "approved" | "rejected";

const views: { id: DemoView; label: string; number: string }[] = [
  { id: "inbox", label: "Lead inbox", number: "01" },
  { id: "pipeline", label: "Pipeline", number: "02" },
  { id: "approval", label: "Approval trail", number: "03" },
];

const leads = [
  ["Arka Components", "Manufacturing", "84", "Today, 10:30"],
  ["Northstar Retail", "Retail", "76", "Today, 12:00"],
  ["Maven Distribution", "Distribution", "69", "Tomorrow"],
];

const stages = [
  { name: "Qualified", count: 11, value: "₹42.8L" },
  { name: "Proposal", count: 6, value: "₹28.2L" },
  { name: "Decision", count: 3, value: "₹18.4L" },
];

export default function OperatingSystemDemo() {
  const [view, setView] = useState<DemoView>("inbox");
  const [approvalDecision, setApprovalDecision] =
    useState<ApprovalDecision>("pending");
  const tabRefs = useRef<Record<DemoView, HTMLButtonElement | null>>({
    inbox: null,
    pipeline: null,
    approval: null,
  });

  function selectTab(next: DemoView, focus = false) {
    setView(next);
    if (focus) {
      window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
    }
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex = index;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % views.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + views.length) % views.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = views.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    selectTab(views[nextIndex].id, true);
  }

  return (
    <div className="os-demo" aria-label="Interactive Vercentlabs CRM preview">
      <div className="os-demo__sample-label">
        Illustrative workflow · synthetic data · not customer proof
      </div>

      <div className="os-demo__topbar">
        <div className="os-demo__window-meta">
          <span className="os-demo__mark" aria-hidden="true">
            V
          </span>
          <div>
            <strong>Vercentlabs / Revenue operations</strong>
            <span>North company · Pune branch</span>
          </div>
        </div>
        <div className="os-demo__topbar-actions">
          <span className="os-demo__icon-control" aria-hidden="true">
            <Search />
          </span>
          <span className="os-demo__live">
            <i aria-hidden="true" /> Preview state
          </span>
          <span className="os-demo__avatar" aria-label="Illustrative user">
            AC
          </span>
        </div>
      </div>

      <div className="os-demo__body">
        <aside
          className="os-demo__sidebar"
          aria-label="Preview application navigation"
        >
          <span className="is-active">
            <LayoutDashboard aria-hidden="true" />
            CRM
          </span>
          <span>
            <UsersRound aria-hidden="true" />
            Contacts
          </span>
          <span>
            <Activity aria-hidden="true" />
            Activities
          </span>
          <span>
            <ShieldCheck aria-hidden="true" />
            Controls
          </span>
          <span>
            <Building2 aria-hidden="true" />
            Context
          </span>
        </aside>

        <div className="os-demo__workspace">
          <div className="os-demo__view-header">
            <div>
              <span className="os-mono-label">Illustrative command view</span>
              <h2>Customer operations</h2>
            </div>
            <div className="os-demo__view-tools" aria-hidden="true">
              <span>
                <Filter /> Filter
              </span>
              <span>
                <SlidersHorizontal /> View
              </span>
            </div>
          </div>

          <div
            className="os-demo__tabs"
            role="tablist"
            aria-label="Preview views"
          >
            {views.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => {
                  tabRefs.current[item.id] = element;
                }}
                id={`demo-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                aria-controls={`demo-panel-${item.id}`}
                tabIndex={view === item.id ? 0 : -1}
                className={view === item.id ? "is-active" : undefined}
                onClick={() => selectTab(item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <span>{item.number}</span>
                {item.label}
              </button>
            ))}
          </div>

          <div className="os-demo__panel-wrap">
            {view === "inbox" ? <LeadInbox /> : null}
            {view === "pipeline" ? <Pipeline /> : null}
            {view === "approval" ? (
              <ApprovalTrail
                decision={approvalDecision}
                onDecision={setApprovalDecision}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function LeadInbox() {
  return (
    <section
      id="demo-panel-inbox"
      role="tabpanel"
      aria-labelledby="demo-tab-inbox"
      className="os-demo-panel"
    >
      <div className="os-demo__summary-row">
        <div>
          <span>Open leads</span>
          <strong>24</strong>
          <small>synthetic preview</small>
        </div>
        <div>
          <span>Qualified</span>
          <strong>11</strong>
          <small>illustrative state</small>
        </div>
        <div>
          <span>Follow-ups due</span>
          <strong>07</strong>
          <small>sample workload</small>
        </div>
      </div>

      <div className="os-demo__table">
        <div className="os-demo__table-head">
          <span>Account</span>
          <span>Segment</span>
          <span>Score</span>
          <span>Next action</span>
        </div>
        {leads.map(([account, segment, score, action]) => (
          <div className="os-demo__table-row" key={account}>
            <span>
              <i>{account.slice(0, 1)}</i>
              <b>{account}</b>
            </span>
            <span>{segment}</span>
            <span>
              <em>{score}</em>
            </span>
            <span>{action}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pipeline() {
  return (
    <section
      id="demo-panel-pipeline"
      role="tabpanel"
      aria-labelledby="demo-tab-pipeline"
      className="os-demo-panel"
    >
      <div className="os-demo__pipeline">
        {stages.map((stage, index) => (
          <article key={stage.name}>
            <header>
              <span>
                <CircleDot aria-hidden="true" /> {stage.name}
              </span>
              <b>{stage.count}</b>
            </header>
            <div className={index === 2 ? "is-selected" : undefined}>
              <span className="os-mono-label">SAMPLE-00{index + 7}</span>
              <h3>
                {index === 0
                  ? "Arka Components"
                  : index === 1
                    ? "Nova Industrial"
                    : "Maven Distribution"}
              </h3>
              <p>
                {index === 0
                  ? "Plant rollout"
                  : index === 1
                    ? "CRM migration"
                    : "Multi-branch pilot"}
              </p>
              <footer>
                <strong>{stage.value}</strong>
                <span>{78 + index * 5}%</span>
              </footer>
            </div>
            <div>
              <span className="os-mono-label">SYNTHETIC</span>
              <h3>
                {index === 0
                  ? "Kite Services"
                  : index === 1
                    ? "Orbit Retail"
                    : "Saffron Works"}
              </h3>
              <p>Discovery in progress</p>
              <footer>
                <strong>₹{9 + index * 2}.6L</strong>
                <span>{58 + index * 4}%</span>
              </footer>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ApprovalTrail({
  decision,
  onDecision,
}: {
  decision: ApprovalDecision;
  onDecision: (decision: ApprovalDecision) => void;
}) {
  const statusLabel =
    decision === "pending"
      ? "Pending"
      : decision === "approved"
        ? "Approved"
        : "Rejected";

  return (
    <section
      id="demo-panel-approval"
      role="tabpanel"
      aria-labelledby="demo-tab-approval"
      className="os-demo-panel"
    >
      <div className="os-approval-layout">
        <div className="os-approval-request">
          <span className="os-mono-label">SAMPLE REQUEST / AR-0921</span>
          <div className="os-approval-request__title">
            <div>
              <h3>Move opportunity to Decision</h3>
              <p>Nova Industrial · ₹18.4L · synthetic record</p>
            </div>
            <span data-decision={decision}>{statusLabel}</span>
          </div>
          <dl>
            <div>
              <dt>Requested by</dt>
              <dd>Illustrative revenue user</dd>
            </div>
            <div>
              <dt>Command</dt>
              <dd>CRM opportunity stage change</dd>
            </div>
            <div>
              <dt>Operating context</dt>
              <dd>North company / Pune</dd>
            </div>
          </dl>
          <div className="os-approval-request__actions">
            <button
              type="button"
              disabled={decision !== "pending"}
              onClick={() => onDecision("rejected")}
            >
              <X aria-hidden="true" /> Reject preview
            </button>
            <button
              type="button"
              disabled={decision !== "pending"}
              onClick={() => onDecision("approved")}
            >
              <Check aria-hidden="true" /> Approve preview
            </button>
          </div>
        </div>

        <ol className="os-audit-trail" aria-live="polite">
          <li>
            <span>
              <FileCheck2 aria-hidden="true" />
            </span>
            <div>
              <strong>Request created</strong>
              <small>10:32 · command captured</small>
            </div>
          </li>
          <li>
            <span>
              <ShieldCheck aria-hidden="true" />
            </span>
            <div>
              <strong>Permission verified</strong>
              <small>10:32 · policy matched</small>
            </div>
          </li>
          <li>
            <span>
              <Clock3 aria-hidden="true" />
            </span>
            <div>
              <strong>
                {decision === "pending"
                  ? "Decision waiting"
                  : decision === "approved"
                    ? "Command approved"
                    : "Command rejected"}
              </strong>
              <small>
                {decision === "pending"
                  ? "Assigned to revenue lead"
                  : "Illustrative decision recorded"}
              </small>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
