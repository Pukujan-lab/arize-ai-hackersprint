// The one drawer the workspace uses for detail: a side sheet with a fixed head, a scrolling body and
// an optional footer of actions. Every panel that shows more about something — an authority, a run,
// the map layers — opens in this shape, so the reader learns one gesture.

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left";
  className?: string;
};

export default function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "right",
  className,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className={cn("flex w-full flex-col gap-0 p-0 sm:max-w-lg", side === "left" && "sm:max-w-sm", className)}
      >
        <SheetHeader className="shrink-0 space-y-1 border-b border-border px-4 py-3 pr-12 text-left">
          <SheetTitle className="text-sm font-semibold leading-snug">{title}</SheetTitle>
          {description && (
            <SheetDescription className="text-xs leading-relaxed text-muted-foreground">{description}</SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="shrink-0 border-t border-border px-4 py-3">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
