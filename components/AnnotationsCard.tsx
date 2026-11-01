"use client";

import { useState } from "react";
import { MapPin, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { dayKey } from "@/lib/utils";

// Dated notes pinned to the net worth timeline. The point is context: a dip in
// the chart means something once "market crash" or "bought car" sits on it.
export default function AnnotationsCard() {
  const annotations = useStore((s) => s.annotations);
  const addAnnotation = useStore((s) => s.addAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);

  const [date, setDate] = useState(dayKey());
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !date) return;
    addAnnotation(date, label, note);
    setLabel("");
    setNote("");
  }

  const newestFirst = [...annotations].sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  return (
    <section className="card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <MapPin size={16} className="text-amber-400" />
        Life events
      </h2>
      <p className="mb-3 mt-1 text-xs text-muted">
        Pin what happened. Events show as markers on the net worth chart, so the
        jumps and dips have a reason attached.
      </p>

      {newestFirst.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted">
          Nothing pinned yet. Try things like changed jobs, bought a car, or
          started the agency.
        </p>
      ) : (
        <ul className="mb-3 space-y-2">
          {newestFirst.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{a.label}</span>
                  <span className="text-xs text-muted">
                    {new Date(`${a.date}T00:00:00`).toLocaleDateString()}
                  </span>
                </div>
                {a.note && (
                  <p className="text-xs text-muted">{a.note}</p>
                )}
              </div>
              <button
                onClick={() => removeAnnotation(a.id)}
                title="Remove event"
                className="shrink-0 text-muted hover:text-rose-400"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input w-auto text-sm"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="What happened"
          className="input min-w-0 flex-1 text-sm"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Detail (optional)"
          className="input min-w-0 flex-1 text-sm"
        />
        <button
          type="submit"
          disabled={!label.trim()}
          className="input w-auto px-3 text-sm font-medium text-amber-400 disabled:opacity-40"
        >
          Pin
        </button>
      </form>
    </section>
  );
}
