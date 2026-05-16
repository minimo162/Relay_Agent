import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--ra-accent)_20%,transparent)] disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        primary: "primary-button",
        secondary: "secondary-button",
        ghost: "h-9 px-3 text-[var(--ra-muted)] hover:text-[var(--ra-accent)]",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ asChild = false, className, variant, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}
