// The sections the sidebar navigates between, and the heading each one shows.
// Kept out of the components so the nav, the page header and the mobile bar all
// read from one list and cannot drift apart.

export type Section =
  | "dashboard"
  | "networth"
  | "assets"
  | "goals"
  | "spending"
  | "transactions"
  | "inbox"
  | "reports"
  | "bubbles";

export const SECTION_HEADINGS: Record<
  Section,
  { title: string; subtitle: string }
> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Everything at a glance",
  },
  networth: {
    title: "Net worth",
    subtitle: "How the total has moved, and what moved it",
  },
  assets: {
    title: "Assets",
    subtitle: "Every balance being tracked, and what it is worth",
  },
  goals: {
    title: "Goals",
    subtitle: "Targets, earning rate, and how you compare",
  },
  spending: {
    title: "Spending",
    subtitle: "Analytics and insights",
  },
  transactions: {
    title: "Transactions",
    subtitle: "All your income and expenses",
  },
  inbox: {
    title: "Inbox",
    subtitle: "Monthly digests and milestones reached",
  },
  bubbles: {
    title: "Bubble map",
    subtitle: "Your wallets, who they paid and who paid them. Drag, zoom, tap a bubble",
  },
  reports: {
    title: "Reports",
    subtitle: "Export your data, or print a statement",
  },
};
