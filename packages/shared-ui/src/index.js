import { createElement } from "react";

export function StatusBadge({ children, tone = "neutral", className = "", ...props }) {
  const tones = { neutral: "neutral", success: "success", warning: "pending", danger: "inactive", roadmap: "pending" };
  return createElement("span", { ...props, className: ["status-badge", tones[tone] || tones.neutral, className].filter(Boolean).join(" ") }, children);
}

export function EmptyState({ title, description, action, className = "" }) {
  return createElement("div", { className: ["empty-state", className].filter(Boolean).join(" "), role: "status" },
    createElement("strong", null, title),
    description ? createElement("p", null, description) : null,
    action || null,
  );
}

export function FieldError({ id, children }) {
  return children ? createElement("p", { id, className: "inline-error", role: "alert" }, children) : null;
}
