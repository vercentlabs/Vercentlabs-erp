import { useState } from "react";
import { Avatar } from "../data-display/Avatar.tsx";
import { Button } from "../actions/Button.tsx";
import { TextArea } from "../data-entry/TextArea.tsx";
import { cn } from "../utilities/cn.ts";

export interface Comment {
  id: string;
  authorName: string;
  authorAvatarUrl?: string;
  body: string;
  timestamp: string;
}

export interface CommentThreadProps {
  className?: string;
  comments: Comment[];
  onSubmit?: (body: string) => void;
  isSubmitting?: boolean;
  /** Hide the composer — e.g. the viewer lacks permission to comment. */
  canComment?: boolean;
}

export function CommentThread({ className, comments, onSubmit, isSubmitting, canComment = true }: CommentThreadProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit() {
    if (!draft.trim() || !onSubmit) return;
    onSubmit(draft.trim());
    setDraft("");
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {comments.length === 0 ? (
        <p className="text-sm text-text-muted">No comments yet</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2.5">
              <Avatar name={comment.authorName} src={comment.authorAvatarUrl} size="sm" />
              <div className="flex-1 rounded-[var(--radius-card)] bg-surface-muted p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-text">{comment.authorName}</p>
                  <p className="text-xs text-text-muted">{comment.timestamp}</p>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{comment.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canComment && onSubmit && (
        <div className="flex flex-col gap-2">
          <TextArea aria-label="Add a comment" placeholder="Add a comment…" rows={2} value={draft} onChange={setDraft} />
          <Button variant="primary" size="compact" className="self-end" isDisabled={!draft.trim()} isLoading={isSubmitting} onPress={handleSubmit}>
            Comment
          </Button>
        </div>
      )}
    </div>
  );
}
