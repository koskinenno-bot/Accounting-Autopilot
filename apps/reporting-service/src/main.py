import os
from typing import Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from auth import require_auth
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


async def resolve_fiscal_year(company_id: str, fiscal_year_id: Optional[str], authorization: Optional[str]) -> Optional[Dict]:
    """Pyydetty tilikausi tai oletuksena avoin (uusin) tilikausi. Raportit lasketaan aina yhdeltä
    kaudelta: seuraavan kauden avausvienti sisältää jo edellisen saldot (muuten tase kahdentuisi)."""
    years = await _get("/accounting/fiscal-years", {"companyId": company_id}, authorization)
    if fiscal_year_id:
        fy = next((y for y in years if y["id"] == fiscal_year_id), None)
        if not fy:
            raise HTTPException(status_code=404, detail="Tilikautta ei löydy")
        return fy
    open_years = [y for y in years if y["status"] == "OPEN"]
    candidates = open_years or years
    return min(candidates, key=lambda y: y["startDate"]) if open_years else (max(candidates, key=lambda y: y["startDate"]) if candidates else None)


async def fetch_ledger(company_id: str, fiscal_year: Optional[Dict], include_drafts: bool,
                       authorization: Optional[str]) -> List[Dict]:
    params = {"companyId": company_id}
    if not include_drafts:
        params["status"] = POSTED_STATUSES
    ledger = await _get("/accounting/ledger", params, authorization)
    if not fiscal_year:
        return ledger
    # Rajaus päivämäärällä (myös luonnokset, joilta tilikausi-id puuttuu)
    start, end = fiscal_year["startDate"][:10], fiscal_year["endDate"][:10]
    return [e for e in ledger if start <= e["entryDate"][:10] <= end]


def _without_closing(ledger: List[Dict]) -> List[Dict]:
    """Tilinpäätösvienti siirtää tuloksen taseeseen; tuloslaskelmaan se ei kuulu."""
    return [e for e in ledger if e.get("entryType") != "CLOSING"]


async def fetch_company_name(company_id: str, authorization: Optional[str]) -> str:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{USER_SERVICE_URL}/companies", headers={"Authorization": authorization or ""})
            r.raise_for_status()
            return next((c["name"] for c in r.json() if c["id"] == company_id), "Yhtiö")
    except httpx.HTTPError:
        return "Yhtiö"


async def fetch_account_names(company_id: str, authorization: Optional[str]) -> Dict[str, str]:
    try:
        accounts = await _get("/accounting/accounts", {"companyId": company_id}, authorization)
        return {a["accountNumber"]: a["accountName"] for a in accounts}
    except HTTPException:
        return {}


@app.get("/health")
async def health():
    return {"status": "ok", "service": "reporting-service"}


async def _build(kind: str, company_id: str, fiscal_year_id: Optional[str], include_drafts: bool,
                 authorization: Optional[str]) -> Tuple[Dict, Optional[Dict]]:
    fy = await resolve_fiscal_year(company_id, fiscal_year_id, authorization)
    ledger = await fetch_ledger(company_id, fy, include_drafts, authorization)
    if kind == "maintenance-calculation":
        flows = _without_closing(ledger)
        data = build_maintenance_calculation(account_balances(flows), loan_repayments(flows))
    else:
        names = await fetch_account_names(company_id, authorization)
        data = (build_income_statement(account_balances(_without_closing(ledger)), names) if kind == "income-statement"
                else build_balance_sheet(account_balances(ledger), names))
    return {**data, "fiscalYear": fy}, fy


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
    pdf = render_report(report, data, company, fy)
    year = fy["endDate"][:4] if fy else "kaikki"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{report}-{year}.pdf"'})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 3006)))
