import type { HTMLAttributes, ReactNode } from "react";
export function StatusBadge(props: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" | "roadmap" }): ReactNode;
export function EmptyState(props: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }): ReactNode;
export function FieldError(props: { id?: string; children?: ReactNode }): ReactNode;
