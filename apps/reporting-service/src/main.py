import os
from typing import Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from auth import require_auth
from closing import (NOTE_SECTIONS, REPORT_SECTIONS, balance_details, budget_comparison, default_notes,
                     default_report, general_ledger, journal_rows, merge_sections, period_text)
from closing_pdf import render_balance_details, render_closing_package, render_general_ledger, render_journal
from pdf import render_report
from reports import (account_balances, build_balance_sheet, build_income_statement,
                     build_maintenance_calculation, loan_repayments)

load_dotenv()

app = FastAPI(title="AI Accountant Reporting Service", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

ACCOUNTING_SERVICE_URL = os.getenv("ACCOUNTING_SERVICE_URL", "http://localhost:3002/api/v1")
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://localhost:3001/api/v1")

# Raportteihin otetaan oletuksena vain kirjatut viennit (KPL). Luonnokset näkyvät,
# jos kutsuja pyytää includeDrafts=true.
POSTED_STATUSES = "POSTED,LOCKED"


def _forward_headers(authorization: Optional[str]) -> Dict[str, str]:
    # Käyttäjän kutsussa välitetään VAIN käyttäjän tunniste: silloin accounting-service
    # tarkistaa yhtiön jäsenyyden. Palvelutunniste ohittaisi tarkistuksen, joten sitä
    # käytetään vain palveluiden välisissä kutsuissa (ei käyttäjää).
    if authorization:
        return {"Authorization": authorization}
    service_token = os.getenv("SERVICE_TOKEN")
    return {"x-service-token": service_token} if service_token else {}


async def _get(path: str, params: Dict, authorization: Optional[str]):
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            response = await client.get(f"{ACCOUNTING_SERVICE_URL}{path}", params=params,
                                        headers=_forward_headers(authorization))
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            # Käyttöoikeusvirheet välitetään sellaisenaan (403 = ei pääsyä yhtiöön)
            if e.response.status_code in (400, 401, 403, 404):
                try:
                    detail = e.response.json().get("error")
                except ValueError:
                    detail = None
                raise HTTPException(status_code=e.response.status_code, detail=detail or "Kirjanpitopalvelu hylkäsi pyynnön")
            # Aiemmin virhe nieltiin ja palautettiin tyhjä raportti, joka näytti nollatulokselta.
            raise HTTPException(status_code=502, detail=f"Kirjanpitopalvelu vastasi {e.response.status_code}")
        except httpx.HTTPError as e:
            raise HTTPException(status_code=503, detail=f"Kirjanpitopalvelua ei tavoiteta: {e}")


async def resolve_fiscal_years(company_id: str, fiscal_year_id: Optional[str],
                               authorization: Optional[str]) -> Tuple[Optional[Dict], Optional[Dict]]:
    """Pyydetty tilikausi (oletuksena vanhin avoin, muuten uusin) ja sitä edeltävä tilikausi vertailutiedoiksi
    (KPL 3:1a §). Raportit lasketaan aina yhdeltä kaudelta: seuraavan kauden avausvienti sisältää jo
    edellisen saldot (muuten tase kahdentuisi)."""
    years = await _get("/accounting/fiscal-years", {"companyId": company_id}, authorization)
    if fiscal_year_id:
        fy = next((y for y in years if y["id"] == fiscal_year_id), None)
        if not fy:
            raise HTTPException(status_code=404, detail="Tilikautta ei löydy")
    else:
        open_years = [y for y in years if y["status"] == "OPEN"]
        fy = (min(open_years, key=lambda y: y["startDate"]) if open_years
              else max(years, key=lambda y: y["startDate"]) if years else None)
    earlier = [y for y in years if fy and y["startDate"] < fy["startDate"]]
    prev = max(earlier, key=lambda y: y["startDate"]) if earlier else None
    return fy, prev


async def resolve_fiscal_year(company_id: str, fiscal_year_id: Optional[str], authorization: Optional[str]) -> Optional[Dict]:
    return (await resolve_fiscal_years(company_id, fiscal_year_id, authorization))[0]


async def fetch_full_ledger(company_id: str, include_drafts: bool, authorization: Optional[str]) -> List[Dict]:
    params = {"companyId": company_id}
    if not include_drafts:
        params["status"] = POSTED_STATUSES
    return await _get("/accounting/ledger", params, authorization)


def within(ledger: List[Dict], fiscal_year: Optional[Dict]) -> List[Dict]:
    """Rajaus päivämäärällä (myös luonnokset, joilta tilikausi-id puuttuu)."""
    if not fiscal_year:
        return ledger
    start, end = fiscal_year["startDate"][:10], fiscal_year["endDate"][:10]
    return [e for e in ledger if start <= e["entryDate"][:10] <= end]


async def fetch_ledger(company_id: str, fiscal_year: Optional[Dict], include_drafts: bool,
                       authorization: Optional[str]) -> List[Dict]:
    return within(await fetch_full_ledger(company_id, include_drafts, authorization), fiscal_year)


def _without_closing(ledger: List[Dict]) -> List[Dict]:
    """Tilinpäätösvienti siirtää tuloksen taseeseen; tuloslaskelmaan se ei kuulu."""
    return [e for e in ledger if e.get("entryType") != "CLOSING"]


async def fetch_company(company_id: str, authorization: Optional[str]) -> Dict:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{USER_SERVICE_URL}/companies", headers={"Authorization": authorization or ""})
            r.raise_for_status()
            found = next((c for c in r.json() if c["id"] == company_id), None)
            if found:
                return {"name": found["name"], "businessId": found.get("businessId"), "companyType": found.get("companyType", "AS_OY")}
    except httpx.HTTPError:
        pass
    return {"name": "Yhtiö", "businessId": None, "companyType": "AS_OY"}


async def fetch_company_name(company_id: str, authorization: Optional[str]) -> str:
    return (await fetch_company(company_id, authorization))["name"]


async def fetch_account_names(company_id: str, authorization: Optional[str]) -> Dict[str, str]:
    try:
        accounts = await _get("/accounting/accounts", {"companyId": company_id}, authorization)
        return {a["accountNumber"]: a["accountName"] for a in accounts}
    except HTTPException:
        return {}


@app.get("/health")
async def health():
    return {"status": "ok", "service": "reporting-service"}


def _report(kind: str, ledger: List[Dict], names: Dict[str, str], prev_ledger: Optional[List[Dict]]) -> Dict:
    if kind == "maintenance-calculation":
        flows = _without_closing(ledger)
        data = build_maintenance_calculation(account_balances(flows), loan_repayments(flows))
        if prev_ledger is not None:
            prev_flows = _without_closing(prev_ledger)
            data["previous"] = build_maintenance_calculation(account_balances(prev_flows), loan_repayments(prev_flows))
        return data
    if kind == "income-statement":
        prev = account_balances(_without_closing(prev_ledger)) if prev_ledger is not None else None
        return build_income_statement(account_balances(_without_closing(ledger)), names, prev)
    prev = account_balances(prev_ledger) if prev_ledger is not None else None
    return build_balance_sheet(account_balances(ledger), names, prev)


async def _build(kind: str, company_id: str, fiscal_year_id: Optional[str], include_drafts: bool,
                 authorization: Optional[str]) -> Tuple[Dict, Optional[Dict]]:
    fy, prev_fy = await resolve_fiscal_years(company_id, fiscal_year_id, authorization)
    full = await fetch_full_ledger(company_id, include_drafts, authorization)
    ledger = within(full, fy)
    prev_ledger = within(full, prev_fy) if prev_fy else None
    # Edellinen kausi vertailuksi vain, jos sille on kirjauksia (ensimmäisellä kaudella sarake jää pois)
    if prev_ledger is not None and not prev_ledger:
        prev_ledger, prev_fy = None, None
    names = {} if kind == "maintenance-calculation" else await fetch_account_names(company_id, authorization)
    data = _report(kind, ledger, names, prev_ledger)
    return {**data, "fiscalYear": fy, "previousFiscalYear": prev_fy}, fy


@app.get("/api/v1/reports/income-statement")
async def get_income_statement(companyId: str, fiscalYearId: Optional[str] = None, includeDrafts: bool = False,
                               authorization: Optional[str] = Header(default=None),
                               user: dict = Depends(require_auth)):
    return (await _build("income-statement", companyId, fiscalYearId, includeDrafts, authorization))[0]


@app.get("/api/v1/reports/balance-sheet")
async def get_balance_sheet(companyId: str, fiscalYearId: Optional[str] = None, includeDrafts: bool = False,
                            authorization: Optional[str] = Header(default=None),
                            user: dict = Depends(require_auth)):
    return (await _build("balance-sheet", companyId, fiscalYearId, includeDrafts, authorization))[0]


@app.get("/api/v1/reports/maintenance-calculation")
async def get_maintenance_calculation(companyId: str, fiscalYearId: Optional[str] = None, includeDrafts: bool = False,
                                      authorization: Optional[str] = Header(default=None),
                                      user: dict = Depends(require_auth)):
    return (await _build("maintenance-calculation", companyId, fiscalYearId, includeDrafts, authorization))[0]


@app.get("/api/v1/reports/pdf")
async def get_report_pdf(companyId: str, report: str, fiscalYearId: Optional[str] = None,
                         authorization: Optional[str] = Header(default=None),
                         user: dict = Depends(require_auth)):
    if report not in ("income-statement", "balance-sheet", "maintenance-calculation"):
        raise HTTPException(status_code=400, detail="report: income-statement, balance-sheet tai maintenance-calculation")
    data, fy = await _build(report, companyId, fiscalYearId, False, authorization)
    company = await fetch_company_name(companyId, authorization)
    pdf = render_report(report, data, company, fy, data.get("previousFiscalYear"))
    year = fy["endDate"][:4] if fy else "kaikki"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{report}-{year}.pdf"'})


# --- Tilinpäätöspaketti (moduuli 7) ---------------------------------------------------------------------

def _pdf(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{filename}"'})


async def _closing_context(company_id: str, fiscal_year_id: Optional[str], authorization: Optional[str]) -> Dict:
    fy, prev_fy = await resolve_fiscal_years(company_id, fiscal_year_id, authorization)
    if not fy:
        raise HTTPException(status_code=404, detail="Yhtiöllä ei ole tilikausia")
    full = await fetch_full_ledger(company_id, False, authorization)
    ledger = within(full, fy)
    prev_ledger = within(full, prev_fy) if prev_fy else None
    if prev_ledger is not None and not prev_ledger:
        prev_ledger, prev_fy = None, None
    names = await fetch_account_names(company_id, authorization)
    package = await _get(f"/accounting/fiscal-years/{fy['id']}/closing-package", {}, authorization)
    budget = await _get(f"/accounting/fiscal-years/{fy['id']}/budget", {}, authorization)
    assets = await _get("/accounting/assets", {"companyId": company_id}, authorization)
    company = await fetch_company(company_id, authorization)

    flows = _without_closing(ledger)
    balances = account_balances(ledger)
    prev_balances = account_balances(prev_ledger) if prev_ledger is not None else None
    income = build_income_statement(account_balances(flows), names,
                                    account_balances(_without_closing(prev_ledger)) if prev_ledger is not None else None)
    maintenance = None
    if company["companyType"] != "KOY":
        maintenance = build_maintenance_calculation(account_balances(flows), loan_repayments(flows))
        if prev_ledger is not None:
            pf = _without_closing(prev_ledger)
            maintenance["previous"] = build_maintenance_calculation(account_balances(pf), loan_repayments(pf))
    comparison = budget_comparison(account_balances(flows), budget["lines"], names)
    opening = account_balances([e for e in ledger if e.get("entryType") == "OPENING"])
    ctx = {
        "company": company, "fiscalYear": fy, "previousFiscalYear": prev_fy, "package": package, "names": names,
        "incomeStatement": income, "balanceSheet": build_balance_sheet(balances, names, prev_balances),
        "maintenance": maintenance, "budget": comparison, "balances": balances, "prevBalances": prev_balances,
        "openingBalances": opening, "assets": assets, "ledger": ledger,
    }
    ctx["report"] = merge_sections(REPORT_SECTIONS, default_report(ctx), package.get("report") or {})
    ctx["notes"] = merge_sections(NOTE_SECTIONS, default_notes(ctx), package.get("notes") or {})
    ctx["balanceDetails"] = balance_details(ledger, prev_balances, names, package.get("balanceNotes") or {})
    return ctx


@app.get("/api/v1/reports/closing-package")
async def get_closing_package(companyId: str, fiscalYearId: Optional[str] = None,
                              authorization: Optional[str] = Header(default=None), user: dict = Depends(require_auth)):
    """Tilinpäätöspaketin tekstit (automaattinen pohja + tallennetut), tase-erittelyt ja talousarviovertailu."""
    ctx = await _closing_context(companyId, fiscalYearId, authorization)
    missing = [f"{part}: {sec['title']}" for part, secs in (("Toimintakertomus", ctx["report"]), ("Liitetiedot", ctx["notes"]))
               for sec in secs if sec["needsInput"]]
    if not ctx["package"].get("signers"):
        missing.append("Allekirjoittajat puuttuvat")
    if ctx["fiscalYear"]["status"] != "CLOSED":
        missing.append("Tilikausi on avoinna (sulje tilikausi Tilinpäätös-sivulla)")
    return {
        "company": ctx["company"], "fiscalYear": ctx["fiscalYear"], "previousFiscalYear": ctx["previousFiscalYear"],
        "package": ctx["package"], "report": ctx["report"], "notes": ctx["notes"],
        "balanceDetails": ctx["balanceDetails"], "budget": ctx["budget"], "netProfit": ctx["incomeStatement"]["netProfit"],
        "missing": missing,
    }


@app.get("/api/v1/reports/closing-package/pdf")
async def get_closing_package_pdf(companyId: str, fiscalYearId: Optional[str] = None,
                                  authorization: Optional[str] = Header(default=None), user: dict = Depends(require_auth)):
    ctx = await _closing_context(companyId, fiscalYearId, authorization)
    return _pdf(render_closing_package(ctx), f"tilinpaatos-{ctx['fiscalYear']['endDate'][:4]}.pdf")


@app.get("/api/v1/reports/balance-details/pdf")
async def get_balance_details_pdf(companyId: str, fiscalYearId: Optional[str] = None,
                                  authorization: Optional[str] = Header(default=None), user: dict = Depends(require_auth)):
    ctx = await _closing_context(companyId, fiscalYearId, authorization)
    pdf = render_balance_details(ctx["company"], ctx["fiscalYear"], ctx["balanceDetails"], ctx["prevBalances"] is not None)
    return _pdf(pdf, f"tase-erittelyt-{ctx['fiscalYear']['endDate'][:4]}.pdf")


async def _books(company_id: str, fiscal_year_id: Optional[str], authorization: Optional[str]):
    fy = await resolve_fiscal_year(company_id, fiscal_year_id, authorization)
    if not fy:
        raise HTTPException(status_code=404, detail="Yhtiöllä ei ole tilikausia")
    ledger = await fetch_ledger(company_id, fy, False, authorization)
    return fy, ledger, await fetch_company(company_id, authorization)


@app.get("/api/v1/reports/journal/pdf")
async def get_journal_pdf(companyId: str, fiscalYearId: Optional[str] = None,
                          authorization: Optional[str] = Header(default=None), user: dict = Depends(require_auth)):
    fy, ledger, company = await _books(companyId, fiscalYearId, authorization)
    return _pdf(render_journal(company, fy, journal_rows(ledger)), f"paivakirja-{fy['endDate'][:4]}.pdf")


@app.get("/api/v1/reports/general-ledger/pdf")
async def get_general_ledger_pdf(companyId: str, fiscalYearId: Optional[str] = None,
                                 authorization: Optional[str] = Header(default=None), user: dict = Depends(require_auth)):
    fy, ledger, company = await _books(companyId, fiscalYearId, authorization)
    names = await fetch_account_names(companyId, authorization)
    return _pdf(render_general_ledger(company, fy, general_ledger(ledger, names)), f"paakirja-{fy['endDate'][:4]}.pdf")


@app.get("/api/v1/reports/budget-comparison")
async def get_budget_comparison(companyId: str, fiscalYearId: Optional[str] = None,
                                authorization: Optional[str] = Header(default=None), user: dict = Depends(require_auth)):
    fy = await resolve_fiscal_year(companyId, fiscalYearId, authorization)
    if not fy:
        raise HTTPException(status_code=404, detail="Yhtiöllä ei ole tilikausia")
    ledger = await fetch_ledger(companyId, fy, False, authorization)
    budget = await _get(f"/accounting/fiscal-years/{fy['id']}/budget", {}, authorization)
    names = await fetch_account_names(companyId, authorization)
    return {**budget_comparison(account_balances(_without_closing(ledger)), budget["lines"], names),
            "fiscalYear": fy, "period": period_text(fy)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 3006)))
