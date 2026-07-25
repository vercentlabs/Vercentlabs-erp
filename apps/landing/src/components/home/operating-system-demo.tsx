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
} from "lucide-react";
import { useState } from "react";

type DemoView = "inbox" | "pipeline" | "approval";

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

  return (
    <div className="os-demo" aria-label="Interactive VercentLabs CRM preview">
      <div className="os-demo__topbar">
        <div className="os-demo__window-meta">
          <span className="os-demo__mark" aria-hidden="true">
            V
          </span>
          <div>
            <strong>VercentLabs / Revenue operations</strong>
            <span>North company · Pune branch</span>
          </div>
        </div>
        <div className="os-demo__topbar-actions">
          <button type="button" aria-label="Search preview">
            <Search aria-hidden="true" />
          </button>
          <span className="os-demo__live">
            <i aria-hidden="true" /> Live control
          </span>
          <span className="os-demo__avatar">AC</span>
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
              <span className="os-mono-label">Command view / 2026</span>
              <h2>Customer operations</h2>
            </div>
            <div className="os-demo__view-tools">
              <button type="button">
                <Filter aria-hidden="true" /> Filter
              </button>
              <button type="button">
                <SlidersHorizontal aria-hidden="true" /> View
              </button>
            </div>
          </div>

          <div
            className="os-demo__tabs"
            role="tablist"
            aria-label="Preview views"
          >
            {views.map((item) => (
              <button
                key={item.id}
                id={`demo-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                aria-controls={`demo-panel-${item.id}`}
                tabIndex={view === item.id ? 0 : -1}
                className={view === item.id ? "is-active" : undefined}
                onClick={() => setView(item.id)}
              >
                <span>{item.number}</span>
                {item.label}
              </button>
            ))}
          </div>

          <div className="os-demo__panel-wrap">
            {view === "inbox" ? <LeadInbox /> : null}
            {view === "pipeline" ? <Pipeline /> : null}
            {view === "approval" ? <ApprovalTrail /> : null}
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
          <small>+6 this week</small>
        </div>
        <div>
          <span>Qualified</span>
          <strong>11</strong>
          <small>46% conversion</small>
        </div>
        <div>
          <span>Follow-ups due</span>
          <strong>07</strong>
          <small>2 need attention</small>
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
              <span className="os-mono-label">OPP-00{index + 7}</span>
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
              <span className="os-mono-label">NEXT</span>
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

function ApprovalTrail() {
  return (
    <section
      id="demo-panel-approval"
      role="tabpanel"
      aria-labelledby="demo-tab-approval"
      className="os-demo-panel"
    >
      <div className="os-approval-layout">
        <div className="os-approval-request">
          <span className="os-mono-label">REQUEST / AR-0921</span>
          <div className="os-approval-request__title">
            <div>
              <h3>Move opportunity to Decision</h3>
              <p>Nova Industrial · ₹18.4L</p>
            </div>
            <span>Pending</span>
          </div>
          <dl>
            <div>
              <dt>Requested by</dt>
              <dd>Priya Shah</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>High-value stage gate</dd>
            </div>
            <div>
              <dt>Operating context</dt>
              <dd>North company / Pune</dd>
            </div>
          </dl>
          <div className="os-approval-request__actions">
            <button type="button">Reject</button>
            <button type="button">
              <Check aria-hidden="true" /> Approve command
            </button>
          </div>
        </div>

        <ol className="os-audit-trail">
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
              <strong>Decision waiting</strong>
              <small>Assigned to revenue lead</small>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
