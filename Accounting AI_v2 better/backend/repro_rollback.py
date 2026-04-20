import requests
import json

BASE_URL = "http://localhost:8000"

def test_rollback():
    # 1. Login to get token
    login_res = requests.post(f"{BASE_URL}/auth/login", data={
        "username": "admin@example.com",
        "password": "password123"
    })
    if login_res.status_code != 200:
        print(f"Login failed: {login_res.text}")
        return
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. List jobs
    jobs_res = requests.get(f"{BASE_URL}/companies/1/transactions/import-jobs", headers=headers)
    jobs = jobs_res.json()
    if not isinstance(jobs, list) or not jobs:
        print(f"Failed to fetch jobs correctly: {jobs}")
        return

    job_id = jobs[0]["id"]
    print(f"Attempting to rollback Job {job_id} ({jobs[0]['filename']})...")

    # 3. Trigger Rollback
    del_res = requests.delete(f"{BASE_URL}/companies/1/transactions/import-jobs/{job_id}", headers=headers)
    print(f"Rollback Status: {del_res.status_code}")
    print(f"Rollback Response: {del_res.json()}")

    # 4. Check if txs are gone
    from sqlmodel import Session, select, func
    from database import engine
    from models import Transaction
    session = Session(engine)
    count = session.exec(select(func.count(Transaction.id)).where(Transaction.import_job_id == job_id)).one()
    print(f"Remaining transactions for Job {job_id}: {count}")

if __name__ == "__main__":
    test_rollback()
