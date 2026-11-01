import base64
import binascii
import os
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
from dotenv import load_dotenv
from fastapi import Depends

from auth import require_auth
from classifier import KNOWLEDGE_BASE, SUSPENSE_ACCOUNT, is_expense_account, is_revenue_account, match_keywords  # noqa: F401
from extractor import (ExtractionFailed, ExtractionUnavailable, classify_with_claude, extract_bank_statement,
                       extract_voucher, has_api_key)

load_dotenv()

app = FastAPI(title="AI Accountant ML Service", version="1.1.0")

# Dashboard kutsuu palvelua selaimesta (health + tiliöintiehdotukset), kuten reporting-serviceä.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

class AccountRef(BaseModel):
    accountNumber: str
    accountName: str


class TransactionData(BaseModel):
    description: str
    amount: float
    date: str
    supplier: Optional[str] = None
    # expense = lähtevä maksu (vain kulutilit), income = saapuva; None = ei rajausta
    kind: Optional[str] = None
    # Yhtiön tilikartta tekoälyluokittelua varten (valinnainen)
    accounts: List[AccountRef] = []

class Prediction(BaseModel):
    account: str
    confidence: float
    label: str

class ClassificationResponse(BaseModel):
    suggested_account: str
    confidence: float
    top_predictions: List[Prediction]
    source: str = "keywords"  # keywords | claude | none
    reason: Optional[str] = None

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ml-service", "ai": has_api_key()}

@app.post("/api/v1/ml/classify-transaction", response_model=ClassificationResponse)
async def classify_transaction(data: TransactionData, user: dict = Depends(require_auth)):
    text = f"{data.description} {data.supplier or ''}".strip().lower()
    predictions = []
    seen = set()
    allowed = {"expense": is_expense_account, "income": is_revenue_account}.get(data.kind or "", lambda _c: True)

    # 1. Avainsanaosumat (sama tili vain kerran; vain maksun suuntaan sopivat tilit)
    for info in match_keywords(text):
        if info["code"] in seen or not allowed(info["code"]):
            continue
        seen.add(info["code"])
        conf = 0.95 if len(predictions) == 0 else 0.75
        predictions.append(Prediction(account=info["code"], confidence=conf, label=info["label"]))

    # 2. Ei avainsanaa -> tekoäly (jos avain ja tilikartta annettu)
    if not predictions and has_api_key() and data.accounts:
        accounts = [a.model_dump() for a in data.accounts if allowed(a.accountNumber) or a.accountNumber == SUSPENSE_ACCOUNT["code"]]
        try:
            ai = await run_in_threadpool(classify_with_claude, data.description, data.supplier, data.amount, data.kind, accounts)
            label = next((a["accountName"] for a in accounts if a["accountNumber"] == ai["account"]), ai["account"])
            return ClassificationResponse(
                suggested_account=ai["account"], confidence=ai["confidence"],
                top_predictions=[Prediction(account=ai["account"], confidence=ai["confidence"], label=label)],
                source="claude", reason=ai["reason"],
            )
        except ExtractionFailed as e:
            print(f"Tekoälyluokittelu epäonnistui: {e}")

    # 3. Ei osumia -> selvitettävät erät
    if not predictions:
        predictions.append(Prediction(
            account=SUSPENSE_ACCOUNT["code"],
            confidence=0.1,
            label=SUSPENSE_ACCOUNT["label"]
        ))
    
    sorted_preds = sorted(predictions, key=lambda x: x.confidence, reverse=True)
    top = sorted_preds[0]
    
    return ClassificationResponse(
        suggested_account=top.account,
        confidence=top.confidence,
        top_predictions=sorted_preds[:3],
        source="keywords" if top.account != SUSPENSE_ACCOUNT["code"] else "none",
    )

class VoucherFile(BaseModel):
    fileBase64: str
    mimeType: str
    filename: Optional[str] = None
    accounts: List[AccountRef] = []


@app.post("/api/v1/ml/extract-voucher")
async def extract_voucher_endpoint(data: VoucherFile, user: dict = Depends(require_auth)):
    """Ostolaskun/kuitin tietojen luku: Claude (avaimella) tai tekstipohjaisen PDF:n varajäsennin."""
    try:
        raw = base64.b64decode(data.fileBase64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="fileBase64 ei ole kelvollista base64:ää")
    accounts = [a.model_dump() for a in data.accounts]
    try:
        # Claude-kutsu on synkroninen => ajetaan säikeessä, ettei palvelin jumitu
        return await run_in_threadpool(extract_voucher, raw, data.mimeType, accounts)
    except ExtractionUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ExtractionFailed as e:
        raise HTTPException(status_code=422, detail=str(e))


class StatementFile(BaseModel):
    fileBase64: str


@app.post("/api/v1/ml/extract-bank-statement")
async def extract_bank_statement_endpoint(data: StatementFile, user: dict = Depends(require_auth)):
    """PDF-tiliote -> tapahtumat (Claude). bank-service muuntaa ne BankTransaction-muotoon."""
    try:
        raw = base64.b64decode(data.fileBase64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="fileBase64 ei ole kelvollista base64:ää")
    try:
        return await run_in_threadpool(extract_bank_statement, raw)
    except ExtractionUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ExtractionFailed as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/api/v1/ml/feedback")
async def save_feedback(data: Dict, user: dict = Depends(require_auth)):
    # Log feedback for future training
    print(f"ML Feedback: {data}")
    return {"status": "recorded"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8001)))
