"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// The primary action (add a transaction): a solid accent button.
export function LiquidButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn("btn acc", className)} {...props}>
      {children}
    </button>
  );
}
