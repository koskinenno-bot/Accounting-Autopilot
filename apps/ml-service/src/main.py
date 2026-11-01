import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
from dotenv import load_dotenv
from fastapi import Depends

from auth import require_auth
from classifier import KNOWLEDGE_BASE, SUSPENSE_ACCOUNT, match_keywords  # noqa: F401

load_dotenv()

app = FastAPI(title="AI Accountant ML Service", version="1.1.0")

# Dashboard kutsuu palvelua selaimesta (health + tiliöintiehdotukset), kuten reporting-serviceä.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

class TransactionData(BaseModel):
    description: str
    amount: float
    date: str
    supplier: Optional[str] = None

class Prediction(BaseModel):
    account: str
    confidence: float
    label: str

class ClassificationResponse(BaseModel):
    suggested_account: str
    confidence: float
    top_predictions: List[Prediction]

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ml-service"}

@app.post("/api/v1/ml/classify-transaction", response_model=ClassificationResponse)
async def classify_transaction(data: TransactionData, user: dict = Depends(require_auth)):
    text = f"{data.description} {data.supplier or ''}".strip().lower()
    predictions = []
    seen = set()

    # 1. Avainsanaosumat (sama tili vain kerran)
    for info in match_keywords(text):
        if info["code"] in seen:
            continue
        seen.add(info["code"])
        conf = 0.95 if len(predictions) == 0 else 0.75
        predictions.append(Prediction(account=info["code"], confidence=conf, label=info["label"]))

    # 2. Ei osumia -> selvitettävät erät
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
        top_predictions=sorted_preds[:3]
    )

@app.post("/api/v1/ml/feedback")
async def save_feedback(data: Dict, user: dict = Depends(require_auth)):
    # Log feedback for future training
    print(f"ML Feedback: {data}")
    return {"status": "recorded"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8001)))
