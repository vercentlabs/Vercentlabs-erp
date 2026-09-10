"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { ActionButton, ConfirmDialog, Dialog } from "@/shared/design";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
};

type PromptOptions = {
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  multiline?: boolean;
};

type PendingRequest =
  | ({ kind: "confirm"; resolve: (value: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & PromptOptions);

type CrmCommandDialogApi = {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  prompt: (options: PromptOptions | string) => Promise<string | null>;
};

const CrmCommandDialogContext = createContext<CrmCommandDialogApi | null>(null);

function normalizeConfirm(options: ConfirmOptions | string): ConfirmOptions {
  return typeof options === "string" ? { title: options } : options;
}

function normalizePrompt(options: PromptOptions | string): PromptOptions {
  return typeof options === "string" ? { title: options } : options;
}

export function CrmCommandDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [input, setInput] = useState("");

  const confirm = useCallback((options: ConfirmOptions | string) => {
    return new Promise<boolean>((resolve) => {
      setRequest({ kind: "confirm", resolve, ...normalizeConfirm(options) });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions | string) => {
    const normalized = normalizePrompt(options);
    setInput(normalized.initialValue || "");
    return new Promise<string | null>((resolve) => {
      setRequest({ kind: "prompt", resolve, ...normalized });
    });
  }, []);

  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  function cancel() {
    if (!request) return;
    if (request.kind === "confirm") request.resolve(false);
    else request.resolve(null);
    setRequest(null);
    setInput("");
  }

  function accept() {
    if (!request) return;
    if (request.kind === "confirm") request.resolve(true);
    else request.resolve(input);
    setRequest(null);
    setInput("");
  }

  return (
    <CrmCommandDialogContext.Provider value={api}>
      {children}
      {request?.kind === "confirm" ? (
        <ConfirmDialog
          title={request.title}
          description={request.description}
          confirmLabel={request.confirmLabel || "Confirm"}
          tone={request.tone || "danger"}
          onClose={cancel}
          onConfirm={accept}
        />
      ) : null}
      {request?.kind === "prompt" ? (
        <Dialog
          title={request.title}
          description={request.description}
          onClose={cancel}
          variant="centered"
        >
          <label className="crm-command-prompt">
            <span>{request.label || "Details"}</span>
            {request.multiline === false ? (
              <input
                autoFocus
                value={input}
                placeholder={request.placeholder}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    accept();
                  }
                }}
              />
            ) : (
              <textarea
                autoFocus
                rows={4}
                value={input}
                placeholder={request.placeholder}
                onChange={(event) => setInput(event.target.value)}
              />
            )}
          </label>
          <div className="crm-command-prompt__actions">
            <ActionButton onClick={cancel}>Cancel</ActionButton>
            <ActionButton tone="primary" onClick={accept}>{request.confirmLabel || "Continue"}</ActionButton>
          </div>
        </Dialog>
      ) : null}
    </CrmCommandDialogContext.Provider>
  );
}

export function useCrmCommandDialog(): CrmCommandDialogApi {
  const context = useContext(CrmCommandDialogContext);
  if (!context) throw new Error("useCrmCommandDialog must be used inside CrmCommandDialogProvider");
  return context;
}
