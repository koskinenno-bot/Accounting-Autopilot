import os
from typing import Dict, List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from auth import require_auth
from reports import (account_balances, build_balance_sheet, build_income_statement,
                     build_maintenance_calculation)

load_dotenv()

app = FastAPI(title="AI Accountant Reporting Service", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

ACCOUNTING_SERVICE_URL = os.getenv("ACCOUNTING_SERVICE_URL", "http://localhost:3002/api/v1")

# Raportteihin otetaan oletuksena vain kirjatut viennit (KPL). Luonnokset näkyvät,
# jos kutsuja pyytää includeDrafts=true.
POSTED_STATUSES = "POSTED,LOCKED"


def _forward_headers(authorization: Optional[str]) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if authorization:
        headers["Authorization"] = authorization
    service_token = os.getenv("SERVICE_TOKEN")
    if service_token:
        headers["x-service-token"] = service_token
    return headers


async def _get(path: str, params: Dict, authorization: Optional[str]):
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            response = await client.get(f"{ACCOUNTING_SERVICE_URL}{path}", params=params,
                                        headers=_forward_headers(authorization))
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            # Aiemmin virhe nieltiin ja palautettiin tyhjä raportti, joka näytti nollatulokselta.
            raise HTTPException(status_code=502, detail=f"Kirjanpitopalvelu vastasi {e.response.status_code}")
        except httpx.HTTPError as e:
            raise HTTPException(status_code=503, detail=f"Kirjanpitopalvelua ei tavoiteta: {e}")


async def fetch_ledger(company_id: str, fiscal_year_id: Optional[str], include_drafts: bool,
                       authorization: Optional[str]) -> List[Dict]:
    params = {"companyId": company_id}
    if fiscal_year_id:
        params["fiscalYearId"] = fiscal_year_id
    if not include_drafts:
        params["status"] = POSTED_STATUSES
    return await _get("/accounting/ledger", params, authorization)


async def fetch_account_names(company_id: str, authorization: Optional[str]) -> Dict[str, str]:
    try:
        accounts = await _get("/accounting/accounts", {"companyId": company_id}, authorization)
        return {a["accountNumber"]: a["accountName"] for a in accounts}
    except HTTPException:
        return {}


@app.get("/health")
async def health():
    return {"status": "ok", "service": "reporting-service"}


@app.get("/api/v1/reports/income-statement")
async def get_income_statement(companyId: str, fiscalYearId: Optional[str] = None, includeDrafts: bool = False,
                               authorization: Optional[str] = Header(default=None),
                               user: dict = Depends(require_auth)):
    ledger = await fetch_ledger(companyId, fiscalYearId, includeDrafts, authorization)
    names = await fetch_account_names(companyId, authorization)
    return build_income_statement(account_balances(ledger), names)


@app.get("/api/v1/reports/balance-sheet")
async def get_balance_sheet(companyId: str, fiscalYearId: Optional[str] = None, includeDrafts: bool = False,
                            authorization: Optional[str] = Header(default=None),
                            user: dict = Depends(require_auth)):
    ledger = await fetch_ledger(companyId, fiscalYearId, includeDrafts, authorization)
    names = await fetch_account_names(companyId, authorization)
    return build_balance_sheet(account_balances(ledger), names)


@app.get("/api/v1/reports/maintenance-calculation")
async def get_maintenance_calculation(companyId: str, fiscalYearId: Optional[str] = None, includeDrafts: bool = False,
                                      authorization: Optional[str] = Header(default=None),
                                      user: dict = Depends(require_auth)):
    ledger = await fetch_ledger(companyId, fiscalYearId, includeDrafts, authorization)
    return build_maintenance_calculation(account_balances(ledger))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 3006)))
