import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("ra-card", className)} {...props} />;
}
