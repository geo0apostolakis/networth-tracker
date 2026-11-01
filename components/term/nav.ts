import type { Section } from "@/lib/sections";

// Every section, with its "g <key>" shortcut and how the page title reads:
// a solid word, then an outlined one, the way a shell prompt would put it.
// `name` is the plain label the non-terminal looks use.
export const NAV: { id: Section; key: string; label: string; name: string; solid: string; outline: string; cmd: string }[] = [
  { id: "dashboard", key: "d", label: "home", name: "Home", solid: "networth", outline: "(1)", cmd: "cd ~" },
  { id: "inbox", key: "i", label: "inbox", name: "Inbox", solid: "mail", outline: "inbox", cmd: "mail" },
  { id: "transactions", key: "t", label: "txns", name: "Transactions", solid: "tail", outline: "-f txns", cmd: "tail -f" },
  { id: "spending", key: "s", label: "spending", name: "Spending", solid: "spend", outline: "by type", cmd: "du -sh" },
  { id: "networth", key: "n", label: "net worth", name: "Net worth", solid: "net", outline: "worth", cmd: "plot" },
  { id: "goals", key: "g", label: "goals", name: "Goals", solid: "goals", outline: "& rate", cmd: "watch" },
  { id: "assets", key: "a", label: "assets", name: "Assets", solid: "ls", outline: "-l assets", cmd: "ls -l" },
  { id: "bubbles", key: "b", label: "bubbles", name: "Bubble map", solid: "bubble", outline: "map", cmd: "netstat" },
  { id: "reports", key: "r", label: "reports", name: "Reports", solid: "export", outline: "reports", cmd: "tar -c" },
];
