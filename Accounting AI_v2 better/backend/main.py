from contextlib import asynccontextmanager
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from database import create_db_and_tables
from models import User
from auth import get_current_user
from routers import (
    auth, companies, apartments, transactions, reports, rules, categories, loans, budgets, compliance, audit, demo, archive
)
from routers import vastikelaskelma, vat_report

# ── Rate Limiter ──────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schema on startup
    create_db_and_tables()
    
    # Ensure uploads directory exists
    os.makedirs("uploads/receipts", exist_ok=True)
    
    yield
    # Cleanup on shutdown


app = FastAPI(
    title="Accounting Autopilot",
    description="Backend for Finnish housing company (Asunto-osakeyhtiö) automated bookkeeping.",
    version="2.0.0",
    lifespan=lifespan,
)

# ── Rate Limiting Middleware ──────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ── CORS — read from environment ──────────────────────────────────────────────
_origins_env = os.getenv(
    "ALLOWED_ORIGINS", 
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:5173,http://127.0.0.1:5173"
)
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/files/{path:path}")
def get_protected_file(path: str, current_user: User = Depends(get_current_user)):
    """
    Serves files from the uploads directory only to authenticated users.
    In production, this should also check if the user has access to the specific company.
    """
    file_path = f"uploads/{path}"
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Asiakirjaa ei löydy.")
    return FileResponse(file_path)


@app.get("/")
def read_root():
    return {"message": "Welcome to the Accounting Autopilot MVP API"}


app.include_router(auth.router)
app.include_router(companies.router)
app.include_router(apartments.router)
app.include_router(transactions.router)
app.include_router(reports.router)
app.include_router(rules.router)
app.include_router(categories.router)
app.include_router(loans.router)
app.include_router(budgets.router)
app.include_router(compliance.router)
app.include_router(audit.router)
app.include_router(demo.router)
app.include_router(archive.router)
app.include_router(vastikelaskelma.router)  # AsOyL 10:5 § Lakisääteinen
app.include_router(vat_report.router)       # ALV-raportti
