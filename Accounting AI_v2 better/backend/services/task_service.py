import json
import logging
from sqlmodel import Session, create_engine
from database import DATABASE_URL
from models import ImportJob
from services import reconciliation_service

# Simple logging for background tasks
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

engine = create_engine(DATABASE_URL)

def run_import_reconciliation(job_id: int, company_id: int, raw_txs: list):
    """
    Background worker for processing large bank statements.
    Updates the ImportJob status in the database.
    """
    logger.info(f"Starting background job {job_id} for company {company_id}")
    
    with Session(engine) as session:
        try:
            job = session.get(ImportJob, job_id)
            if not job:
                logger.error(f"Job {job_id} not found")
                return
                
            job.status = "PROCESSING"
            session.add(job)
            session.commit()
            
            # Execute core reconciliation
            saved, stats = reconciliation_service.reconcile_transactions(
                raw_txs, 
                company_id, 
                session, 
                job_id
            )
            
            # Update job as finished
            job.status = "COMPLETED"
            job.total_count = len(raw_txs)
            job.import_summary = json.dumps(stats)
            session.add(job)
            session.commit()
            logger.info(f"Job {job_id} completed successfully. Stats: {stats}")
            
        except Exception as e:
            logger.exception(f"Error in background job {job_id}")
            with Session(engine) as session_fail:
                job_fail = session_fail.get(ImportJob, job_id)
                if job_fail:
                    job_fail.status = "FAILED"
                    job_fail.import_summary = json.dumps({"error": str(e)})
                    session_fail.add(job_fail)
                    session_fail.commit()
