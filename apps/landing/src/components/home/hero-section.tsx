"use client";

import PageContainer from "@/components/layout/page-container";
import Header from "@/components/layout/header";
import RevealOnScroll from "@/components/ui/reveal-on-scroll";
import { siteConfig } from "@/lib/site-config";

const platformStats = [
  {
    value: "10 modules",
    label: "one connected ERP platform",
  },
  {
    value: "5 flows",
    label: "core enterprise processes",
  },
  {
    value: "360°",
    label: "operational visibility",
  },
];

const activityFeed = [
  {
    text: "Sales order approved — production demand created automatically",
    time: "2s ago",
    status: "done",
  },
  {
    text: "Material requirement detected — purchase approval requested",
    time: "18s ago",
    status: "done",
  },
  {
    text: "Customer payment received — finance ledger updated",
    time: "1m ago",
    status: "done",
  },
  {
    text: "Low-stock threshold reached — review replenishment proposal",
    time: "now",
    status: "pending",
  },
] as const;

export default function HeroSection() {
  return (
    <div className="relative overflow-hidden bg-(--bg)">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute -left-32 -top-32 h-[560px] w-[560px] rounded-full opacity-[0.18]"
          style={{
            background: "radial-gradient(circle, #6366f1 0%, transparent 70%)",
            animation: "orb-drift-1 18s ease-in-out infinite",
          }}
        />

        <div
          className="absolute -right-20 top-10 h-[400px] w-[400px] rounded-full opacity-[0.12]"
          style={{
            background: "radial-gradient(circle, #0d9488 0%, transparent 70%)",
            animation: "orb-drift-2 22s ease-in-out infinite",
          }}
        />

        <div
          className="absolute bottom-0 left-1/2 h-[300px] w-[700px] -translate-x-1/2 rounded-full opacity-[0.10]"
          style={{
            background: "radial-gradient(ellipse, #7c3aed 0%, transparent 70%)",
            animation: "orb-drift-3 26s ease-in-out infinite",
          }}
        />

        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,23,42,0.06) 1px, transparent 1px),linear-gradient(90deg, rgba(15,23,42,0.06) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />

        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-(--bg) to-transparent" />
      </div>

      <style>{`
        @keyframes orb-drift-1 {
          0%,100% { transform: translate(0,0) scale(1); }
          33% { transform: translate(40px,-30px) scale(1.08); }
          66% { transform: translate(-20px,20px) scale(0.95); }
        }
        @keyframes orb-drift-2 {
          0%,100% { transform: translate(0,0) scale(1); }
          40% { transform: translate(-50px,30px) scale(1.06); }
          75% { transform: translate(20px,-15px) scale(0.97); }
        }
        @keyframes orb-drift-3 {
          0%,100% { transform: translateX(-50%) scale(1); }
          50% { transform: translateX(calc(-50% + 40px)) scale(1.1); }
        }
        @keyframes activity-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scroll-dot {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(14px); opacity: 0; }
        }
      `}</style>

      <Header />

      <section aria-labelledby="hero-headline">
        <PageContainer className="pb-8 pt-6 lg:pt-8">
          <div className="grid items-center gap-8 lg:grid-cols-[1fr_440px] xl:grid-cols-[1fr_460px]">
            <div>
              <div
                className="inline-flex items-center gap-2.5 rounded-full border border-(--border) bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-(--text-muted) backdrop-blur-sm"
                style={{
                  animation: "fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) forwards",
                }}
              >
                <span className="live-dot" aria-hidden="true" />
                Enterprise operations, connected
              </div>

              <h1
                id="hero-headline"
                className="font-display mt-4 leading-[1.1] tracking-tight text-(--text-primary)"
                style={{
                  fontSize: "clamp(1.75rem, 3.5vw + 0.5rem, 3rem)",
                  fontWeight: 800,
                  animation: "fadeUp 0.7s 0.1s cubic-bezier(0.16,1,0.3,1) both",
                }}
              >
                Your entire enterprise,
                <br />
                connected in one system.
                <br />
                <span
                  style={{
                    background:
                      "linear-gradient(135deg, #818cf8 0%, #6366f1 40%, #14b8a6 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  See every operation. Act with control.
                </span>
              </h1>

              <p
                className="mt-3 max-w-[48ch] text-sm leading-relaxed text-(--text-secondary)"
                style={{
                  animation: "fadeUp 0.7s 0.2s cubic-bezier(0.16,1,0.3,1) both",
                }}
              >
                Vercent ERP connects finance, procurement, inventory, sales,
                CRM, manufacturing, people, projects and analytics through one
                secure, workflow-driven enterprise platform.
              </p>

              <div
                className="mt-5 flex flex-col gap-2.5 sm:flex-row"
                style={{
                  animation: "fadeUp 0.7s 0.3s cubic-bezier(0.16,1,0.3,1) both",
                }}
              >
                <a
                  href="#platform-preview"
                  className="inline-flex items-center justify-center gap-2 rounded-full font-bold text-white transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                  style={{
                    minHeight: "44px",
                    paddingLeft: "1.5rem",
                    paddingRight: "1.5rem",
                    fontSize: "0.875rem",
                    background:
                      "linear-gradient(135deg, #6366f1 0%, #4f46e5 50%, #4338ca 100%)",
                    boxShadow: "0 4px 20px rgba(79,70,229,0.40)",
                  }}
                >
                  Explore the platform
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>

                <a
                  href={`mailto:${siteConfig.email}?subject=Vercent ERP product discussion`}
                  className="btn-ghost justify-center text-sm"
                  style={{
                    minHeight: "44px",
                    paddingLeft: "1.25rem",
                    paddingRight: "1.25rem",
                  }}
                >
                  Talk to the founding team
                </a>
              </div>

              <div
                className="mt-5 flex flex-wrap gap-2"
                style={{
                  animation: "fadeUp 0.7s 0.4s cubic-bezier(0.16,1,0.3,1) both",
                }}
              >
                {[
                  "Role-based control",
                  "Approval workflows",
                  "Multi-company ready",
                ].map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-(--border) bg-(--bg-subtle) px-3 py-1 text-xs text-(--text-muted)"
                  >
                    ✓ {item}
                  </span>
                ))}
              </div>

              <div
                className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-(--border) pt-5"
                style={{
                  animation: "fadeUp 0.7s 0.5s cubic-bezier(0.16,1,0.3,1) both",
                }}
              >
                {platformStats.map((stat) => (
                  <div key={stat.label}>
                    <p
                      className="font-display font-bold text-(--text-primary)"
                      style={{
                        fontSize: "clamp(1.125rem, 1.5vw, 1.5rem)",
                      }}
                    >
                      {stat.value}
                    </p>
                    <p className="mt-0.5 text-xs text-(--text-muted)">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <RevealOnScroll delay={200} from="left" className="w-full">
              <div id="platform-preview" className="scroll-mt-28">
                <div
                  className="w-full overflow-hidden rounded-3xl border border-(--border) bg-white shadow-[0_24px_60px_rgba(15,23,42,0.12)]"
                  style={{ backdropFilter: "blur(20px)" }}
                  role="region"
                  aria-label="Vercent ERP Control Room product preview"
                >
                  <div
                    className="flex items-center justify-between px-4 py-3"
                    style={{
                      background: "#0d1224",
                      borderBottom: "1px solid rgba(99,102,241,0.2)",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1.5" aria-hidden="true">
                        <span className="h-3 w-3 rounded-full bg-red-500/60" />
                        <span className="h-3 w-3 rounded-full bg-amber-400/60" />
                        <span className="h-3 w-3 rounded-full bg-green-500/60" />
                      </div>

                      <div
                        className="h-4 w-px bg-white/10"
                        aria-hidden="true"
                      />

                      <p className="text-[11px] font-medium tracking-wide text-slate-400">
                        Vercent ERP — Enterprise Control Room
                      </p>
                    </div>

                    <span
                      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
                      style={{
                        background: "rgba(52,211,153,0.12)",
                        color: "#34d399",
                        border: "1px solid rgba(52,211,153,0.25)",
                      }}
                    >
                      <span
                        className="live-dot"
                        style={{
                          width: 6,
                          height: 6,
                          background: "#34d399",
                        }}
                        aria-hidden="true"
                      />
                      Product preview
                    </span>
                  </div>

                  <div
                    className="flex flex-col gap-1.5 px-4 py-3"
                    style={{ background: "#080c18" }}
                  >
                    {activityFeed.map((item, index) => (
                      <div
                        key={item.text}
                        className="flex items-start gap-3 rounded-xl px-3 py-2"
                        style={{
                          background:
                            item.status === "pending"
                              ? "rgba(245,158,11,0.08)"
                              : "rgba(99,102,241,0.07)",
                          border:
                            item.status === "pending"
                              ? "1px solid rgba(245,158,11,0.2)"
                              : "1px solid rgba(99,102,241,0.15)",
                          animation: `activity-in 0.4s ${index * 0.15}s cubic-bezier(0.16,1,0.3,1) both`,
                        }}
                      >
                        <div
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px]"
                          style={{
                            background:
                              item.status === "pending"
                                ? "rgba(245,158,11,0.2)"
                                : "rgba(99,102,241,0.2)",
                          }}
                          aria-hidden="true"
                        >
                          {item.status === "pending" ? "?" : "✓"}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] leading-snug text-slate-200">
                            {item.text}
                          </p>
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            {item.time}
                          </p>
                        </div>
                      </div>
                    ))}

                    <div
                      className="mt-1 flex items-center gap-2 rounded-xl px-3.5 py-2.5"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 13 13"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M2 6.5h9M7.5 3l3.5 3.5L7.5 10"
                          stroke="#6366f1"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>

                      <p className="text-[11px] text-slate-600">
                        Review the next enterprise action…
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-px border-t border-(--border) bg-(--bg-subtle)">
                    {[
                      {
                        label: "Modules connected",
                        value: "10",
                        color: "#818cf8",
                      },
                      {
                        label: "Core workflows",
                        value: "5",
                        color: "#34d399",
                      },
                      {
                        label: "Open approvals",
                        value: "3",
                        color: "#f59e0b",
                      },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="bg-white px-3 py-2.5 text-center"
                      >
                        <p
                          className="font-display text-sm font-bold"
                          style={{ color: stat.color }}
                        >
                          {stat.value}
                        </p>
                        <p className="mt-0.5 text-[10px] text-(--text-muted)">
                          {stat.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
                  {[
                    "API-first",
                    "India-first architecture",
                    "Audit-aware design",
                  ].map((item) => (
                    <span
                      key={item}
                      className="flex items-center gap-1.5 rounded-full border border-(--border) bg-white px-3.5 py-1.5 text-xs text-(--text-muted)"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        aria-hidden="true"
                      >
                        <circle
                          cx="5"
                          cy="5"
                          r="5"
                          fill="#10b981"
                          fillOpacity="0.2"
                        />
                        <path
                          d="M2.5 5l1.5 1.5 3-3"
                          stroke="#10b981"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </RevealOnScroll>
          </div>

          <div
            className="mt-6 flex flex-col items-center gap-2"
            style={{
              animation: "fadeUp 0.7s 0.8s cubic-bezier(0.16,1,0.3,1) both",
            }}
            aria-hidden="true"
          >
            <span className="text-[10px] uppercase tracking-[0.2em] text-(--text-muted)">
              Scroll to explore
            </span>

            <div className="flex h-9 w-5 items-start justify-center rounded-full border border-(--border) pt-1.5">
              <div
                className="h-1.5 w-1.5 rounded-full bg-(--text-faint)"
                style={{ animation: "scroll-dot 2s ease-in-out infinite" }}
              />
            </div>
          </div>
        </PageContainer>
      </section>
    </div>
  );
}
