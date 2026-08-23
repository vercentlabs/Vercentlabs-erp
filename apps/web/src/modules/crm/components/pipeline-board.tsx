"use client";

import Link from "next/link";
import { DragEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/shared/http/client-request";

type Stage = {
  id: string;
  name: string;
  sequence: number;
  probability: number;
  isWon?: boolean;
  isLost?: boolean;
};
type Opportunity = {
  id: string;
  code: string;
  name: string;
  stageId: string;
  amount: string | number;
  probability: string | number;
  expectedCloseDate?: string | null;
  ownerUserId?: string | null;
  status: string;
};
const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
    Number(value || 0),
  );
export default function CrmPipelineBoard({
  stages,
  opportunities,
  canManage,
}: {
  stages: Stage[];
  opportunities: Opportunity[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState("");
  const [message, setMessage] = useState("");
  const groups = useMemo(
    () =>
      stages.map((stage) => ({
        stage,
        rows: opportunities.filter(
          (opportunity) => opportunity.stageId === stage.id,
        ),
      })),
    [stages, opportunities],
  );
  async function move(id: string, stageId: string) {
    if (!canManage) return;
    setMoving(id);
    setMessage("");
    try {
      const result = await requestJson(
        `/api/crm/opportunities/${id}/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId, note: "Moved from CRM Kanban" }),
        },
      );
      if (!result.ok) throw new Error(result.message || "Stage update failed.");
      setMessage(result.message || "Stage updated.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Stage update failed.",
      );
    } finally {
      setMoving("");
    }
  }
  function dragStart(event: DragEvent, id: string) {
    event.dataTransfer.setData("text/opportunity-id", id);
    event.dataTransfer.effectAllowed = "move";
  }
  function drop(event: DragEvent, stageId: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/opportunity-id");
    if (id) void move(id, stageId);
  }
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      <div className="crm-kanban" aria-label="Opportunity pipeline">
        {groups.map(({ stage, rows }) => (
          <section
            className="crm-kanban-column"
            key={stage.id}
            onDragOver={(event) => {
              if (canManage) event.preventDefault();
            }}
            onDrop={(event) => drop(event, stage.id)}
          >
            <header>
              <div>
                <strong>{stage.name}</strong>
                <small>{stage.probability}% probability</small>
              </div>
              <span>{rows.length}</span>
            </header>
            <div className="crm-kanban-total">
              ₹
              {money(
                rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
              )}
            </div>
            <div className="crm-kanban-cards">
              {rows.map((row) => (
                <article
                  className="crm-opportunity-card"
                  draggable={canManage}
                  onDragStart={(event) => dragStart(event, row.id)}
                  aria-busy={moving === row.id}
                  key={row.id}
                >
                  <span className="status-badge neutral">{row.code}</span>
                  <Link href={`/crm/opportunities/${row.id}`}>
                    <strong>{row.name}</strong>
                  </Link>
                  <b>₹{money(row.amount)}</b>
                  <small>
                    {row.expectedCloseDate
                      ? new Intl.DateTimeFormat("en-IN", {
                          dateStyle: "medium",
                        }).format(new Date(row.expectedCloseDate))
                      : "No close date"}
                  </small>
                  {canManage ? (
                    <label className="kanban-stage-select">
                      <span className="sr-only">Move {row.name}</span>
                      <select
                        value={row.stageId}
                        disabled={moving === row.id}
                        onChange={(event) =>
                          void move(row.id, event.target.value)
                        }
                      >
                        {stages.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </article>
              ))}
              {!rows.length ? (
                <div className="crm-kanban-empty">Drop opportunities here</div>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
