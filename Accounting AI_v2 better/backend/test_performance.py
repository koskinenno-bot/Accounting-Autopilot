import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_performance():
    company_id = 1
    # Assuming job_id 1 exists from previous import
    print("Testing Bulk Verification...")
    start = time.time()
    res = requests.post(f"{BASE_URL}/companies/{company_id}/transactions/bulk-verify")
    print(f"Bulk Verify took: {time.time() - start:.2f}s, Response: {res.json()}")

    print("\nTesting Rollback performance...")
    # Get jobs to find the massive one
    jobs = requests.get(f"{BASE_URL}/companies/{company_id}/transactions/import-jobs").json()
    if jobs:
        job_id = jobs[0]["id"]
        print(f"Deleting Job {job_id}...")
        start = time.time()
        res = requests.delete(f"{BASE_URL}/companies/{company_id}/transactions/import-jobs/{job_id}")
        print(f"Rollback took: {time.time() - start:.2f}s, Response: {res.json()}")
    else:
        print("No jobs found to rollback.")

if __name__ == "__main__":
    test_performance()
