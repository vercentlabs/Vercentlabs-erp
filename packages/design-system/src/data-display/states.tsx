import type { ReactNode } from "react";
import { Inbox, SearchX, AlertOctagon, Lock, type LucideIcon } from "lucide-react";
import { Button } from "../actions/Button.tsx";
import { cn } from "../utilities/cn.ts";

interface StateAction {
  label: string;
  /** For navigation, call your router (e.g. `() => router.push(...)`) —
   * this is a Button, not a link, so state actions stay consistent
   * regardless of whether they navigate or mutate. */
  onPress: () => void;
}

interface BaseStateProps {
  className?: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: StateAction;
  secondaryAction?: StateAction;
}

/** Shared restrained layout for every "nothing/something is wrong here"
 * surface — deliberately plain (an icon glyph, not a cartoon
 * illustration), per the ERP visual-restraint principle. */
function BaseState({ className, icon: Icon, title, description, action, secondaryAction }: BaseStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-canvas-strong text-text-muted">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-text">{title}</p>
        {description && <p className="max-w-sm text-sm text-text-secondary">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex gap-2">
          {action && (
            <Button variant="primary" size="compact" onPress={action.onPress}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="secondary" size="compact" onPress={secondaryAction.onPress}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export type StateProps = Omit<BaseStateProps, "icon">;

/** Nothing has been created yet — distinct from NoResultsState, which
 * means "records exist but this filter/search matched none". */
export function EmptyState(props: StateProps) {
  return <BaseState icon={Inbox} {...props} />;
}

/** A search/filter matched zero records. Always pair with a way to clear
 * the filter — most callers should pass `action` for that. */
export function NoResultsState(props: StateProps) {
  return <BaseState icon={SearchX} {...props} />;
}

/** A request failed (network, server error, unexpected exception) — not
 * for validation errors (those belong inline on the field/form) or for
 * permission denial (use PermissionState, which is not "something broke"). */
export function ErrorState(props: StateProps) {
  return <BaseState icon={AlertOctagon} {...props} />;
}

/** The user lacks authorization for this record/action. Per the
 * permission-UX standard: only render this when the user should know the
 * capability exists but lacks authority — if knowing it exists at all
 * would itself be inappropriate, don't render anything (HIDDEN, not this). */
export function PermissionState(props: StateProps) {
  return <BaseState icon={Lock} {...props} />;
}
