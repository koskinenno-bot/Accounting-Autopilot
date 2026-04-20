import requests
import json
import os

API_URL = "http://localhost:8000"
COMPANY_ID = 1
FILE_PATH = r"c:\Users\koski\Documents\Accounting AI_v2 better\backend\Tilikartta\as24tilikartta.pdf"

def test_chart_upload():
    print(f"Testing upload of {FILE_PATH}...")
    
    # 1. Login to get token
    login_url = f"{API_URL}/auth/token"
    login_data = {"username": "admin@example.com", "password": "password123"}
    resp = requests.post(login_url, data=login_data)
    if resp.status_code != 200:
        print(f"Login failed: {resp.text}")
        return
    token = resp.json()["access_token"]
    print("Login successful.")

    # 2. Upload file
    upload_url = f"{API_URL}/companies/{COMPANY_ID}/categories/upload"
    headers = {"Authorization": f"Bearer {token}"}
    
    with open(FILE_PATH, "rb") as f:
        files = {"file": (os.path.basename(FILE_PATH), f, "application/pdf")}
        try:
            print("Sending request to backend (this may take 10-30 seconds)...")
            resp = requests.post(upload_url, headers=headers, files=files, timeout=60)
            print(f"Status: {resp.status_code}")
            print(f"Response: {resp.text}")
        except Exception as e:
            print(f"Upload failed: {e}")

if __name__ == "__main__":
    test_chart_upload()
