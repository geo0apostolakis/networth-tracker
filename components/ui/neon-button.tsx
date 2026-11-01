import React from "react";
import { cn } from "@/lib/utils";

// Kept under its old name so every caller still compiles; it now renders the
// terminal button (.btn in globals.css). `neon` is accepted and ignored.
type Variant = "default" | "solid" | "ghost";
type Size = "default" | "sm" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  neon?: boolean;
  variant?: Variant | null;
  size?: Size | null;
}

const VARIANT: Record<Variant, string> = { default: "", solid: "pri", ghost: "ghost" };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ className, neon, size, variant, children, ...props }, ref) => (
    <button ref={ref} className={cn("btn", VARIANT[variant ?? "default"], size === "sm" && "min-h-[26px] px-2", className)} {...props}>
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export { Button };
