import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";

// Bitrefill purchases via the personal API (Bearer key, server-side only).
// Only paid invoices count. Each order is returned as one normalized entry:
//   - "credit"   buying Bitrefill store credit (a transfer of your own money)
//   - "purchase" a gift card / eSIM / top-up, paid from credit ("dashboard",
//                "balance") or directly (crypto, card)
// Nothing identifying (email, payment address) leaves the server.

const API = "https://api.bitrefill.com/v2";

interface Invoice {
  id: string;
  created_time: string;
  completed_time?: string | null;
  status: string;
  payment?: { method?: string; currency?: string; price?: number; status?: string };
  orders?: { id: string; status: string; created_time?: string; product?: { id?: string; name?: string; value?: string; currency?: string } }[];
}

const FIAT = new Set(["EUR", "USD", "GBP", "CHF", "CAD", "AUD"]);
const FROM_CREDIT = new Set(["dashboard", "balance"]);

export async function GET(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  const key = process.env.BITREFILL_API_KEY;
  if (!key) return NextResponse.json({ configured: false, entries: [] });
  try {
    const invoices: Invoice[] = [];
    for (let start = 0; start < 1000; start += 50) {
      const res = await fetch(`${API}/invoices?start=${start}&limit=50`, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) throw new Error(`bitrefill ${res.status}`);
      const page = (await res.json()) as { data?: Invoice[]; meta?: { count?: number } };
      invoices.push(...(page.data ?? []));
      if (!page.data || page.data.length < 50) break;
    }

    const entries = [];
    for (const inv of invoices) {
      const pay = inv.payment ?? {};
      if (pay.status !== "complete") continue; // created-but-unpaid invoices never happened
      const orders = (inv.orders ?? []).filter((o) => o.status !== "failed" && o.status !== "refunded");
      const method = pay.method ?? "";
      const paidFiat = FIAT.has((pay.currency ?? "").toUpperCase()) ? Number(pay.price) : null;
      for (const o of orders) {
        const p = o.product ?? {};
        const face = Number(p.value);
        const faceFiat = FIAT.has((p.currency ?? "").toUpperCase()) && isFinite(face) ? face : null;
        const isCredit = /store credit/i.test(p.name ?? "") || /credit/i.test(p.id ?? "");
        // What it cost: the fiat price paid when there is one (includes Bitrefill's
        // margin), otherwise the product's face value. One order per invoice is
        // the norm; with several, the fiat price is split by face value.
        let amount: number | null = null;
        let currency = "EUR";
        if (paidFiat != null && orders.length === 1) {
          amount = paidFiat;
          currency = (pay.currency ?? "EUR").toUpperCase();
        } else if (faceFiat != null) {
          amount = faceFiat;
          currency = (p.currency ?? "EUR").toUpperCase();
        }
        if (amount == null || !(amount > 0)) continue;
        entries.push({
          id: o.id,
          invoiceId: inv.id,
          kind: isCredit ? "credit" : "purchase",
          fromCredit: FROM_CREDIT.has(method),
          method,
          product: p.name ?? "Bitrefill order",
          amount: Math.round(amount * 100) / 100,
          currency,
          date: inv.completed_time ?? o.created_time ?? inv.created_time,
        });
      }
    }
    return NextResponse.json(
      { configured: true, entries, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message : "bitrefill read failed" }, { status: 502 });
  }
}
