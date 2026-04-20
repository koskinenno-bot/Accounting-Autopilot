"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function fmt(n: number) {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }).format(n);
}

interface VatTransaction {
  date: string; voucher_number: string | null; description: string;
  vat_receivable: number; vat_payable: number;
}

interface VatReport {
  company_name: string; business_id: string; period: string;
  vat_receivable: number; vat_payable: number; net_vat: number;
  net_vat_label: string; transactions: VatTransaction[];
}

export default function AlvPage() {
  const { id } = useParams<{ id: string }>();
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState<number | null>(null);
  const [report, setReport] = useState<VatReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = async () => {
    setLoading(true); setError(null);
    try {
      const token = localStorage.getItem("token");
      const q = quarter ? `&quarter=${quarter}` : "";
      const res = await fetch(`${API}/companies/${id}/compliance/vat/${year}${q ? "?" + q.slice(1) : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Virhe ALV-raportin haussa");
      }
      setReport(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchReport(); }, [id, year, quarter]);

  return (
    <div style={{ padding: "2rem", maxWidth: 900, margin: "0 auto", fontFamily: "Inter, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", margin: 0 }}>ALV-raportti</h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 13 }}>Arvonlisäverovelvollisille yhtiöille</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14 }}>
            {[2026, 2025, 2024, 2023].map(y => <option key={y}>{y}</option>)}
          </select>
          <select value={quarter ?? ""} onChange={e => setQuarter(e.target.value ? Number(e.target.value) : null)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14 }}>
            <option value="">Koko vuosi</option>
            <option value="1">Q1 (Tammi–Maalis)</option>
            <option value="2">Q2 (Huhti–Kesä)</option>
            <option value="3">Q3 (Heinä–Syys)</option>
            <option value="4">Q4 (Loka–Joulu)</option>
          </select>
          <button onClick={() => window.print()}
            style={{ padding: "8px 16px", borderRadius: 8, background: "#3b82f6", color: "white", border: "none", cursor: "pointer" }}>
            🖨️ Tulosta
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <p style={{ margin: 0, color: "#dc2626", fontWeight: 600 }}>⚠️ {error}</p>
          {error.includes("ALV-rekisteröity") && (
            <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 13 }}>
              Aktivoi ALV-rekisteröinti yhtiön asetuksissa ensin.
            </p>
          )}
        </div>
      )}

      {loading && <p style={{ color: "#64748b" }}>Ladataan...</p>}

      {report && !loading && (
        <>
          <div style={{ background: "#f8fafc", borderRadius: 12, padding: 20, marginBottom: 24, border: "1px solid #e2e8f0" }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{report.company_name}</p>
            <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>Y-tunnus: {report.business_id} | Kausi: {report.period}</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
            {[
              { label: "Ostojen ALV (saatava)", value: report.vat_receivable, color: "#3b82f6", icon: "📥" },
              { label: "Myynnin ALV (velka)", value: report.vat_payable, color: "#ef4444", icon: "📤" },
              { label: report.net_vat_label, value: Math.abs(report.net_vat), color: report.net_vat >= 0 ? "#ef4444" : "#22c55e", icon: report.net_vat >= 0 ? "💸" : "💰" },
            ].map(({ label, value, color, icon }) => (
              <div key={label} style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid #e2e8f0", textAlign: "center" }}>
                <div style={{ fontSize: 28 }}>{icon}</div>
                <p style={{ margin: "8px 0 4px", fontSize: 12, color: "#64748b" }}>{label}</p>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color }}>{fmt(value)}</p>
              </div>
            ))}
          </div>

          {report.transactions.length > 0 && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
              <h3 style={{ margin: 0, padding: "12px 16px", background: "#f8fafc", fontSize: 14, fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>
                ALV-tapahtumat ({report.transactions.length} kpl)
              </h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#1e293b", color: "white" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Pvm</th>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Tositenro</th>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Selite</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#93c5fd" }}>ALV-saatava</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#fca5a5" }}>ALV-velka</th>
                  </tr>
                </thead>
                <tbody>
                  {report.transactions.map((tx, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "7px 12px", color: "#64748b" }}>{tx.date}</td>
                      <td style={{ padding: "7px 12px", fontFamily: "monospace", color: "#3b82f6" }}>{tx.voucher_number || "—"}</td>
                      <td style={{ padding: "7px 12px" }}>{tx.description}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", color: "#3b82f6" }}>{tx.vat_receivable > 0 ? fmt(tx.vat_receivable) : ""}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", color: "#ef4444" }}>{tx.vat_payable > 0 ? fmt(tx.vat_payable) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
