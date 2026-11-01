"use client";

import type { CSSProperties } from "react";
import { useStore } from "@/lib/store";
import { formatCurrency, MONEY_MASK } from "@/lib/utils";

// Slot-machine ("777") number: every digit is a vertical reel that rolls to its
// new value whenever the amount changes. Currency symbol / separators stay put.
export default function RollingNumber({
  value,
  currency,
  className,
  style,
}: {
  value: number;
  currency: string;
  className?: string;
  style?: CSSProperties;
}) {
  const privacy = useStore((s) => s.privacy);
  if (privacy) {
    return (
      <span className={className} style={style}>
        {MONEY_MASK}
      </span>
    );
  }
  const text = formatCurrency(value, currency);
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "flex-end", lineHeight: 1, ...style }}
    >
      {text.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <Reel key={i} digit={Number(ch)} />
        ) : (
          <span
            key={i}
            style={{
              display: "inline-block",
              height: "1em",
              lineHeight: 1,
              whiteSpace: "pre",
            }}
          >
            {ch}
          </span>
        )
      )}
    </span>
  );
}

function Reel({ digit }: { digit: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        height: "1em",
        lineHeight: 1,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          transform: `translateY(-${digit * 10}%)`,
          // No will-change: with a reel per digit and a number per asset row,
          // that pinned hundreds of GPU layers for the life of the page.
          transition: "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n} style={{ height: "1em", lineHeight: 1 }}>
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
