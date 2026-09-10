"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, EnterpriseDataGrid, PageHeader, SectionHeader, StatePanel } from "@/shared/design";

type Rule = Record<string, unknown>;
type Draft = { weight: string; enabled: boolean; blocking: boolean; threshold: string };

const ENTITY_LABELS: Record<string, string> = {
  lead: "Leads",
  contact: "Contacts",
  account: "Accounts",
};

const SIGNAL_LABELS: Record<string, string> = {
  email: "Email",
  mobile: "Mobile / phone",
  name: "Full name",
  name_and_company: "Name + company name",
  gstin: "GSTIN",
  pan: "PAN",
  legal_name: "Legal / company name",
};

function str(row: Rule, key: string) {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

function ruleKey(rule: Rule) {
  return `${rule.entityType}-${rule.signal}-${rule.method}`;
}

function draftFor(rule: Rule): Draft {
  return {
    weight: String(rule.weight ?? 0),
    enabled: rule.enabled !== false,
    blocking: rule.blocking === true,
    threshold: rule.fuzzyThreshold != null ? String(rule.fuzzyThreshold) : "0.55",
  };
}

function isDirty(rule: Rule, draft: Draft) {
  return (
    draft.weight !== String(rule.weight ?? 0) ||
    draft.enabled !== (rule.enabled !== false) ||
    draft.blocking !== (rule.blocking === true) ||
    (rule.method === "fuzzy" && draft.threshold !== String(rule.fuzzyThreshold ?? "0.55"))
  );
}

export default function DuplicateRulesWorkspace({ rules: initialRules }: { rules: Rule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initialRules.map((rule) => [ruleKey(rule), draftFor(rule)])),
  );
  const [pendingKey, setPendingKey] = useState("");
  const [message, setMessage] = useState("");

  function updateDraft(key: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  async function save(rule: Rule) {
    const key = ruleKey(rule);
    const draft = drafts[key];
    setPendingKey(key);
    setMessage("");
    const result = await requestJson<{ rule?: Rule }>("/api/crm/duplicate-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: rule.entityType,
        signal: rule.signal,
        method: rule.method,
        weight: Number(draft.weight),
        enabled: draft.enabled,
        blocking: draft.blocking,
        fuzzyThreshold: rule.method === "fuzzy" ? Number(draft.threshold) : undefined,
      }),
    });
    setPendingKey("");
    if (!result.ok) {
      setMessage(result.message || "The rule could not be saved.");
      return;
    }
    if (result.rule) {
      const saved = result.rule;
      setRules((current) => {
        const index = current.findIndex((r) => ruleKey(r) === ruleKey(saved));
        if (index === -1) return [...current, saved];
        const next = [...current];
        next[index] = saved;
        return next;
      });
      setDrafts((current) => ({ ...current, [ruleKey(saved)]: draftFor(saved) }));
    }
    router.refresh();
  }

  const byEntity = ["lead", "contact", "account"].map((entityType) => ({
    entityType,
    rows: rules.filter((rule) => rule.entityType === entityType),
  }));

  return (
    <div className="crm-duplicate-rules-page">
      <PageHeader
        eyebrow="CRM · Data quality"
        title="Duplicate detection rules"
        description="Enable, reweight or disable the signals used to flag possible duplicate Leads, Contacts and Accounts. A record is classified an exact/blocking duplicate when any enabled 'blocking' signal matches; otherwise matched weights combine into a probable-duplicate score."
      />
      {message ? <p role="alert">{message}</p> : null}
      {byEntity.map((group) => (
        <section className="panel crm-duplicate-rules-group" key={group.entityType}>
          <SectionHeader eyebrow="Entity" title={ENTITY_LABELS[group.entityType]} />
          <EnterpriseDataGrid<Rule>
            rows={group.rows}
            rowKey={(rule) => ruleKey(rule)}
            caption={`${ENTITY_LABELS[group.entityType]} duplicate-matching rules`}
            emptyState={<StatePanel title="No rules configured for this entity yet." />}
            columns={[
              {
                id: "signal",
                header: "Signal",
                cell: (rule) => SIGNAL_LABELS[str(rule, "signal")] || str(rule, "signal"),
              },
              { id: "method", header: "Method", cell: (rule) => str(rule, "method") },
              {
                id: "weight",
                header: "Weight (0–100)",
                cell: (rule) => {
                  const key = ruleKey(rule);
                  const draft = drafts[key];
                  return (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.weight}
                      onChange={(event) => updateDraft(key, { weight: event.currentTarget.value })}
                      aria-label={`Weight for ${str(rule, "signal")}`}
                    />
                  );
                },
              },
              {
                id: "threshold",
                header: "Fuzzy threshold",
                cell: (rule) => {
                  if (rule.method !== "fuzzy") return "—";
                  const key = ruleKey(rule);
                  const draft = drafts[key];
                  return (
                    <input
                      type="number"
                      min={0.01}
                      max={1}
                      step={0.01}
                      value={draft.threshold}
                      onChange={(event) => updateDraft(key, { threshold: event.currentTarget.value })}
                      aria-label={`Similarity threshold for ${str(rule, "signal")}`}
                    />
                  );
                },
              },
              {
                id: "enabled",
                header: "Enabled",
                cell: (rule) => {
                  const key = ruleKey(rule);
                  const draft = drafts[key];
                  return (
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) => updateDraft(key, { enabled: event.currentTarget.checked })}
                      />
                      Enabled
                    </label>
                  );
                },
              },
              {
                id: "blocking",
                header: "Blocking",
                cell: (rule) => {
                  const key = ruleKey(rule);
                  const draft = drafts[key];
                  return (
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.blocking}
                        onChange={(event) => updateDraft(key, { blocking: event.currentTarget.checked })}
                      />
                      Blocking (exact match)
                    </label>
                  );
                },
              },
              {
                id: "actions",
                header: "",
                cell: (rule) => {
                  const key = ruleKey(rule);
                  const draft = drafts[key];
                  return (
                    <ActionButton
                      tone="primary"
                      busy={pendingKey === key}
                      disabled={!isDirty(rule, draft)}
                      onClick={() => void save(rule)}
                    >
                      Save
                    </ActionButton>
                  );
                },
              },
            ]}
          />
        </section>
      ))}
    </div>
  );
}
