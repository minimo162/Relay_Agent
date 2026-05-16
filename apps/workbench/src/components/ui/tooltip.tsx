import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent(props: TooltipPrimitive.TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content className="tooltip-content" sideOffset={8} {...props} />
    </TooltipPrimitive.Portal>
  );
}
