"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, StatePanel } from "@/shared/design";

type HierarchyRow = Record<string, unknown>;
type AccountOption = { id: string; displayName: string; code?: string };

function str(row: HierarchyRow, key: string) {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

export default function AccountHierarchyPanel({
  accountId,
  canManage,
}: {
  accountId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [hierarchy, setHierarchy] = useState<{
    ancestors: HierarchyRow[];
    descendants: HierarchyRow[];
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AccountOption[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await requestJson<{ hierarchy?: { ancestors?: HierarchyRow[]; descendants?: HierarchyRow[] } }>(
        `/api/crm/accounts/${accountId}/hierarchy`,
      );
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message || "Account hierarchy could not be loaded.");
        return;
      }
      setHierarchy({
        ancestors: result.hierarchy?.ancestors || [],
        descendants: result.hierarchy?.descendants || [],
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    if (!changing) return;
    const search = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (search.length < 2) {
        setOptions([]);
        return;
      }
      const result = await requestJson<{ rows?: AccountOption[] }>(
        `/api/crm/accounts?search=${encodeURIComponent(search)}&status=active&limit=8`,
        { signal: controller.signal },
      );
      if (result.ok) setOptions((result.rows || []).filter((option) => option.id !== accountId));
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [changing, query, accountId]);

  async function setParent(parentPartyId: string | null) {
    setPending(true);
    setMessage("");
    const result = await requestJson<{ message?: string }>(`/api/crm/accounts/${accountId}/hierarchy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPartyId, reason: "Updated from Account 360." }),
    });
    setPending(false);
    if (!result.ok) {
      setMessage(result.message || "The parent account could not be changed.");
      return;
    }
    setChanging(false);
    setQuery("");
    setOptions([]);
    router.refresh();
    // Re-fetch hierarchy to reflect the change immediately.
    const refreshed = await requestJson<{ hierarchy?: { ancestors?: HierarchyRow[]; descendants?: HierarchyRow[] } }>(
      `/api/crm/accounts/${accountId}/hierarchy`,
    );
    if (refreshed.ok) {
      setHierarchy({
        ancestors: refreshed.hierarchy?.ancestors || [],
        descendants: refreshed.hierarchy?.descendants || [],
      });
    }
  }

  if (loadError) {
    return <StatePanel title="Account hierarchy could not be loaded." description={loadError} />;
  }
  if (!hierarchy) {
    return <StatePanel title="Loading account hierarchy…" />;
  }

  const parent = hierarchy.ancestors.find((row) => Number(row.depth) === 1);
  const children = hierarchy.descendants.filter((row) => Number(row.depth) === 1);

  return (
    <div className="crm-account-hierarchy-panel">
      {message ? <p role="alert">{message}</p> : null}
      <dl className="crm-account-facts">
        <div>
          <dt>Parent account</dt>
          <dd>
            {parent ? (
              <Link href={`/crm/accounts/${str(parent, "id")}`}>{str(parent, "display_name")}</Link>
            ) : (
              "None — this is a top-level account"
            )}
          </dd>
        </div>
      </dl>
      {canManage ? (
        changing ? (
          <div className="crm-account-hierarchy-change">
            <label>
              <span>Search for a new parent account</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Type at least two characters"
              />
            </label>
            {options.length ? (
              <ul>
                {options.map((option) => (
                  <li key={option.id}>
                    <button type="button" disabled={pending} onClick={() => void setParent(option.id)}>
                      {option.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <footer>
              <ActionButton onClick={() => { setChanging(false); setQuery(""); setOptions([]); }} disabled={pending}>
                Cancel
              </ActionButton>
              {parent ? (
                <ActionButton tone="danger" busy={pending} onClick={() => void setParent(null)}>
                  Clear parent
                </ActionButton>
              ) : null}
            </footer>
          </div>
        ) : (
          <ActionButton onClick={() => setChanging(true)}>
            {parent ? "Change parent account" : "Set parent account"}
          </ActionButton>
        )
      ) : null}

      <div className="crm-account-hierarchy-children">
        <p className="eyebrow">Child accounts ({children.length})</p>
        {children.length ? (
          <ul>
            {children.map((row) => (
              <li key={str(row, "id")}>
                <Link href={`/crm/accounts/${str(row, "id")}`}>{str(row, "display_name")}</Link>
                {row.status === "inactive" ? <span className="status-badge neutral">Archived</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <StatePanel title="No child accounts." />
        )}
      </div>
    </div>
  );
}
