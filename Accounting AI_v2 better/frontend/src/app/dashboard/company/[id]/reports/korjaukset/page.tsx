"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function fmt(n: number) {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }).format(n);
}

interface RepairLine { code: string; name: string; amount: number; }
interface RepairGroup { title: string; lines: RepairLine[]; total: number; }

export default function KorjauksetPage() {
  const { id } = useParams<{ id: string }>();
  const [year, setYear] = useState(new Date().getFullYear());
  const [groups, setGroups] = useState<RepairGroup[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${API}/companies/${id}/reports/income-statement?start_date=${year}-01-01&end_date=${year}-12-31`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return;
      const data = await res.json();

      // Korjaukset = expense groups with codes 5200–5999 (Vuosikorjaukset, PTS)
      const repairGroups: RepairGroup[] = [];
      let total = 0;
      for (const section of [...(data.expense_groups || [])]) {
        const repairLines = section.lines.filter((l: RepairLine) => {
          const code = parseInt(l.code);
          return code >= 5000 && code <= 5999;
        });
        if (repairLines.length > 0) {
          const groupTotal = repairLines.reduce((s: number, l: RepairLine) => s + l.amount, 0);
          repairGroups.push({ title: section.name, lines: repairLines, total: groupTotal });
          total += groupTotal;
        }
      }
      setGroups(repairGroups);
      setGrandTotal(total);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id, year]);

  return (
    <div style={{ padding: "2rem", maxWidth: 900, margin: "0 auto", fontFamily: "Inter, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", margin: 0 }}>Tehtyjen korjausten laskelma</h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 13 }}>
            AsOyL 10:5 § — Tilikauden aikana toteutetut korjaukset ja investoinnit
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14 }}>
            {[2026, 2025, 2024, 2023].map(y => <option key={y}>{y}</option>)}
          </select>
          <button onClick={() => window.print()}
            style={{ padding: "8px 16px", borderRadius: 8, background: "#3b82f6", color: "white", border: "none", cursor: "pointer" }}>
            🖨️ Tulosta
          </button>
        </div>
      </div>

      {loading && <p style={{ color: "#64748b" }}>Ladataan...</p>}

      {!loading && groups.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
          <div style={{ fontSize: 48 }}>🔧</div>
          <p style={{ marginTop: 16, fontSize: 16 }}>Ei kirjattuja korjauksia vuodelle {year}.</p>
          <p style={{ fontSize: 13 }}>Korjaukset kirjataan tileille 5000–5999 (Hallinto & Korjaukset).</p>
        </div>
      )}

      {!loading && groups.length > 0 && (
        <>
          {/* Summary */}
          <div style={{ background: "#fefce8", border: "2px solid #fbbf24", borderRadius: 12, padding: 20, marginBottom: 24, textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 13, color: "#92400e" }}>KORJAUKSET YHTEENSÄ {year}</p>
            <p style={{ margin: "8px 0 0", fontSize: 32, fontWeight: 800, color: "#b45309" }}>{fmt(grandTotal)}</p>
          </div>

          {groups.map((group) => (
            <div key={group.title} style={{ marginBottom: 20, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ background: "#f8fafc", padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{group.title}</h3>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {group.lines.map((line) => (
                    <tr key={line.code} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 16px", color: "#64748b", width: 80 }}>{line.code}</td>
                      <td style={{ padding: "8px 16px" }}>{line.name}</td>
                      <td style={{ padding: "8px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {fmt(line.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                    <td colSpan={2} style={{ padding: "10px 16px" }}>Yhteensä</td>
                    <td style={{ padding: "10px 16px", textAlign: "right", color: "#b45309" }}>{fmt(group.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}

          <div style={{ padding: "16px", background: "#1e293b", borderRadius: 12, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>KAIKKI KORJAUKSET YHTEENSÄ {year}</span>
            <span style={{ fontWeight: 800, fontSize: 20, color: "#fbbf24" }}>{fmt(grandTotal)}</span>
          </div>
        </>
      )}
    </div>
  );
}
