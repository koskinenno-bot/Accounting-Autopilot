"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ReportLine { code: string; name: string; amount: number; }
interface Group { lines: ReportLine[]; total: number; }
interface VastikelaskelmaReport {
  company_name: string; business_id: string; year: number; legal_basis: string;
  tuotot: { hoitovastikkeet: Group; muut_hoitotuotot: Group; total: number };
  kulut: { [key: string]: Group | number };
  hoitokate: number;
}

const KULUT_LABELS: Record<string, string> = {
  henkilostokulut: "Henkilöstökulut", hallintokulut: "Hallintokulut",
  kaytto_ja_huolto: "Käyttö ja huolto", ulkoalueet: "Ulkoalueiden hoito",
  siivous: "Siivous", lammitys_ja_vesi: "Lämmitys ja vesi",
  sahko_ja_kaasu: "Sähkö ja kaasu", muut_hoitokulut: "Muut hoitokulut",
};

function fmt(n: number) {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }).format(n);
}

export default function VastikelaskelmaPage() {
  const { id } = useParams<{ id: string }>();
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<VastikelaskelmaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = async () => {
    setLoading(true); setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API}/companies/${id}/reports/vastikelaskelma/${year}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Virhe");
      setReport(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchReport(); }, [id, year]);

  const printReport = () => window.print();

  return (
    <div style={{ padding: "2rem", maxWidth: 900, margin: "0 auto", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", margin: 0 }}>
            Vastikerahoituslaskelma
          </h1>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 13 }}>
            AsOyL 10:5 § — Lakisääteinen raportti
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14 }}
          >
            {[2026, 2025, 2024, 2023].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={printReport}
            style={{ padding: "8px 16px", borderRadius: 8, background: "#3b82f6", color: "white", border: "none", cursor: "pointer", fontSize: 14 }}
          >
            🖨️ Tulosta
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: 16, color: "#dc2626", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && <p style={{ color: "#64748b" }}>Ladataan...</p>}

      {report && !loading && (
        <div id="vastikelaskelma-print">
          {/* Company info */}
          <div style={{ background: "#f8fafc", borderRadius: 12, padding: 20, marginBottom: 24, border: "1px solid #e2e8f0" }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 18 }}>{report.company_name}</p>
            <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
              Y-tunnus: {report.business_id} | Tilikausi: {report.year} | {report.legal_basis}
            </p>
          </div>

          {/* TUOTOT */}
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", borderBottom: "2px solid #3b82f6", paddingBottom: 8, marginBottom: 12 }}>
              TUOTOT
            </h2>
            <ReportGroupTable title="Hoitovastikkeet" group={report.tuotot.hoitovastikkeet} />
            <ReportGroupTable title="Muut hoitotuotot" group={report.tuotot.muut_hoitotuotot} />
            <TotalRow label="TUOTOT YHTEENSÄ" amount={report.tuotot.total} positive />
          </section>

          {/* KULUT */}
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", borderBottom: "2px solid #ef4444", paddingBottom: 8, marginBottom: 12 }}>
              KULUT
            </h2>
            {Object.entries(KULUT_LABELS).map(([key, label]) => {
              const group = (report.kulut as any)[key] as Group;
              if (!group || group.total === 0) return null;
              return <ReportGroupTable key={key} title={label} group={group} />;
            })}
            <TotalRow label="KULUT YHTEENSÄ" amount={(report.kulut as any).total} negative />
          </section>

          {/* HOITOKATE */}
          <div style={{
            background: report.hoitokate >= 0 ? "#f0fdf4" : "#fef2f2",
            border: `2px solid ${report.hoitokate >= 0 ? "#22c55e" : "#ef4444"}`,
            borderRadius: 12, padding: 20, textAlign: "center"
          }}>
            <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>HOITOKATE (Ylijäämä / Alijäämä)</p>
            <p style={{ margin: "8px 0 0", fontSize: 28, fontWeight: 800, color: report.hoitokate >= 0 ? "#16a34a" : "#dc2626" }}>
              {fmt(report.hoitokate)}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a3b8" }}>
              {report.hoitokate >= 0 ? "Ylijäämä — tuotot kattavat kulut" : "Alijäämä — tarvitaan lisärahoitusta"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportGroupTable({ title, group }: { title: string; group: Group }) {
  if (group.total === 0 && group.lines.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontWeight: 600, fontSize: 13, color: "#374151", margin: "0 0 4px" }}>{title}</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {group.lines.map((line) => (
            <tr key={line.code} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "4px 8px", color: "#64748b" }}>{line.code}</td>
              <td style={{ padding: "4px 8px" }}>{line.name}</td>
              <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(line.amount)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, background: "#f8fafc" }}>
            <td colSpan={2} style={{ padding: "6px 8px" }}>Yhteensä</td>
            <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(group.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TotalRow({ label, amount, positive, negative }: { label: string; amount: number; positive?: boolean; negative?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 8px", fontWeight: 800, fontSize: 15, borderTop: "2px solid #1e293b", marginTop: 8 }}>
      <span>{label}</span>
      <span style={{ color: positive ? "#16a34a" : negative ? "#dc2626" : "#1e293b" }}>{fmt(amount)}</span>
    </div>
  );
}
