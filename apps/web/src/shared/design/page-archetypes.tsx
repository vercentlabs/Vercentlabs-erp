import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";
import styles from "./page-archetypes.module.css";

export type PageArchetypeKind =
  | "list-work-queue"
  | "record-360"
  | "transaction-document"
  | "board"
  | "operations-workspace";

type ArchetypeProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

function ArchetypeFrame({
  kind,
  className,
  children,
  ...props
}: ArchetypeProps & { kind: PageArchetypeKind }) {
  const styleKey = {
    "list-work-queue": "listWorkQueue",
    "record-360": "record360",
    "transaction-document": "transactionDocument",
    board: "board",
    "operations-workspace": "operationsWorkspace",
  }[kind] as keyof typeof styles;

  return (
    <div
      {...props}
      className={cx(styles.frame, styles[styleKey], className)}
      data-erp-archetype={kind}
    >
      {children}
    </div>
  );
}

export function ListWorkQueueArchetype(props: ArchetypeProps) {
  return <ArchetypeFrame {...props} kind="list-work-queue" />;
}

export function Record360Archetype(props: ArchetypeProps) {
  return <ArchetypeFrame {...props} kind="record-360" />;
}

export function TransactionDocumentArchetype(props: ArchetypeProps) {
  return <ArchetypeFrame {...props} kind="transaction-document" />;
}

export function BoardArchetype(props: ArchetypeProps) {
  return <ArchetypeFrame {...props} kind="board" />;
}

export function OperationsWorkspaceArchetype(props: ArchetypeProps) {
  return <ArchetypeFrame {...props} kind="operations-workspace" />;
}
