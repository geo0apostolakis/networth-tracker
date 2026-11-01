// Two levels of heading. GroupHeading labels a group of panes; CardHeader is
// the pane's own title bar: "NN title ──── subtitle  [action]". The NN comes
// from a CSS counter on .card, so panes number themselves down the page.

import type { ReactNode } from "react";

export function GroupHeading({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-2 mt-1 flex items-end justify-between gap-3 ${className ?? ""}`}>
      <div className="min-w-0">
        <h2 className="eyebrow">
          <span className="n">{"▸ "}</span>
          {title}
        </h2>
        {subtitle && <p className="mt-1 truncate text-xs text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    // shrink-0: inside a viewport-sized card the header keeps its height and
    // the chart below absorbs the squeeze.
    <div className="mb-3 flex shrink-0 items-center gap-3">
      <div className="pane-h min-w-0 flex-1">
        <span className="n" aria-hidden />
        {icon && <span className="acc flex items-center [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>}
        <h3 className="t">{title}</h3>
        <span className="rule" aria-hidden />
        {subtitle && <span className="meta">{subtitle}</span>}
      </div>
      {action && <div className="act shrink-0">{action}</div>}
    </div>
  );
}
