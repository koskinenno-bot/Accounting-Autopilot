"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { fetchWithAuth } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface JournalLine {
  id: number; side: "DEBIT" | "CREDIT"; account_code: string; account_name: string; amount: number;
}
interface Transaction {
  id: number; date: string; description: string; voucher_number: string | null;
  amount: number; journal_lines?: JournalLine[];
}

function fmt(n: number) {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }).format(n);
}

export default function DoubleEntryPage() {
  const { id } = useParams<{ id: string }>();
  const [year, setYear] = useState(new Date().getFullYear());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(
        `/companies/${id}/transactions?start_date=${year}-01-01&end_date=${year}-12-31`
      );
      const data = await res.json();
      setTransactions(data.filter((t: any) => t.is_verified));
    } catch (err) {
        console.error("Failed to load transactions", err);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id, year]);

  const filtered = transactions.filter(t =>
    !search || t.description.toLowerCase().includes(search.toLowerCase()) ||
    (t.voucher_number || "").includes(search)
  );

  const totalDebit = filtered.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
  const totalCredit = filtered.reduce((s, t) => s + (t.amount < 0 ? Math.abs(t.amount) : 0), 0);

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto", fontFamily: "Inter, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", margin: 0 }}>
            Kahdenkertainen päiväkirja
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 13 }}>KPL 2:1 § — Kaikki vahvistetut kirjaukset debit/kredit-muodossa</p>
        </div>
        <div style={{ display: "flex", gap: 12}}>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14 }}>
            {[2026, 2025, 2024, 2023].map(y => <option key={y}>{y}</option>)}
          </select>
          <input placeholder="Hae tositteita..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14, width: 200 }} />
          <button onClick={() => window.print()}
            style={{ padding: "8px 16px", borderRadius: 8, background: "#3b82f6", color: "white", border: "none", cursor: "pointer", fontSize: 14 }}>
            🖨️ Tulosta
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Veloitukset (Debet)", value: fmt(totalDebit), color: "#3b82f6" },
          { label: "Hyvitykset (Kredit)", value: fmt(totalCredit), color: "#ef4444" },
          { label: "Saldo", value: fmt(totalDebit - totalCredit), color: Math.abs(totalDebit - totalCredit) < 0.01 ? "#22c55e" : "#f59e0b" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#f8fafc", borderRadius: 12, padding: 16, border: "1px solid #e2e8f0" }}>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>{label}</p>
            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color }}>{value}</p>
          </div>
        ))}
      </div>

      {loading && <p style={{ color: "#64748b" }}>Ladataan...</p>}

      {/* Journal entries table */}
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#1e293b", color: "white" }}>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Pvm</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Tositenro</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Selite</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Tili</th>
              <th style={{ padding: "10px 12px", textAlign: "right", color: "#93c5fd" }}>Debet</th>
              <th style={{ padding: "10px 12px", textAlign: "right", color: "#fca5a5" }}>Kredit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tx, i) => (
              <tr key={tx.id} style={{ background: i % 2 === 0 ? "white" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 12px", color: "#64748b" }}>{tx.date}</td>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#3b82f6" }}>
                  {tx.voucher_number || "—"}
                </td>
                <td style={{ padding: "8px 12px" }}>{tx.notes || tx.description || "Ei selitettä"}</td>
                <td style={{ padding: "8px 12px", color: "#475569" }}>
                  {tx.category_code ? `${tx.category_code} ${tx.category_name || ''}` : "—"}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "#3b82f6", fontVariantNumeric: "tabular-nums" }}>
                  {tx.amount > 0 ? fmt(tx.amount) : ""}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: "#ef4444", fontVariantNumeric: "tabular-nums" }}>
                  {tx.amount < 0 ? fmt(Math.abs(tx.amount)) : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#1e293b", color: "white", fontWeight: 700 }}>
              <td colSpan={4} style={{ padding: "10px 12px" }}>YHTEENSÄ ({filtered.length} kirjausta)</td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "#93c5fd" }}>{fmt(totalDebit)}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "#fca5a5" }}>{fmt(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {filtered.length === 0 && !loading && (
        <p style={{ textAlign: "center", color: "#94a3b8", padding: 40 }}>
          Ei vahvistettuja tapahtumia valitulle vuodelle.
        </p>
      )}
    </div>
  );
}
