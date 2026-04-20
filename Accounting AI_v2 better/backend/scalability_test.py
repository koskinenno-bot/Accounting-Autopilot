import requests
import json
import time
import random
from datetime import datetime, date

BASE_URL = "http://localhost:8000"

def run_scalability_assurance():
    print("--- STARTING SCALABILITY & TRUST ASSURANCE TEST ---")
    print("-" * 50)

    # 0. Login to get token
    print("Authenticating...")
    login_res = requests.post(f"{BASE_URL}/auth/login", data={
        "username": "admin@example.com",
        "password": "password123"
    })
    if login_res.status_code != 200:
        print(f"Auth failed: {login_res.text}")
        return
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Create a fresh test company to isolate results
    # For simplicity, we use company_id 1 which is seeded
    company_id = 1
    
    # 2. Generate a large batch of synthetic data
    # We want a mix: 40% Reference (easy), 40% Rules (medium), 20% AI (hard)
    test_data = []
    
    # Standard TALO-2024 category codes
    rules = ["Fortum", "Helen", "HSY", "Isännöinti", "Lassila", "Siivous"]
    
    print(f"Generating 200 synthetic transactions...")
    for i in range(200):
        # Determine match type simulation
        r = random.random()
        if r < 0.4: # Reference Match
            # Seed has ref 100018 (A1 checksummed is usually ref-type)
            # We use a pattern that we know exists in seed
            test_data.append({
                "date": str(date.today()),
                "amount": round(random.uniform(150, 400), 2),
                "description": f"Vastike huoneisto A{random.randint(1,5)}",
                "reference_number": "100018", # Seeded for A1
            })
        elif r < 0.8: # Rule Match
            keyword = random.choice(rules)
            test_data.append({
                "date": str(date.today()),
                "amount": round(random.uniform(-500, -50), 2),
                "description": f"Lasku: {keyword} Oy",
                "reference_number": None,
            })
        else: # AI Match (Complex/Unstructured)
            test_data.append({
                "date": str(date.today()),
                "amount": round(random.uniform(-100, -10), 2),
                "description": f"Ostos K-Market malli {random.randint(100,999)}", # Needs AI to map to 4900/6830
                "reference_number": None,
            })

    # 3. Execution Phase
    print(f"Uploading batch to API...")
    
    # We cheat a bit and call reconcile directly via a test-injection 
    # OR we use the standard CSV route. Using standard CSV is more realistic.
    csv_content = "date,amount,description,reference_number\n"
    for row in test_data:
        csv_content += f"{row['date']},{row['amount']},{row['description']},{row['reference_number'] or ''}\n"
    
    start_time = time.time()
    
    files = {'file': ('scalability_test.csv', csv_content)}
    response = requests.post(f"{BASE_URL}/companies/{company_id}/transactions/import", files=files, headers=headers)
    
    end_time = time.time()
    batch_duration = end_time - start_time
    
    # 4. Analysis Phase
    if response.status_code == 201 or response.status_code == 200:
        result = response.json()
        print("-" * 50)
        print("OK: TEST COMPLETED SUCCESSFULLY")
        print(f"Time: {batch_duration:.2f} seconds")
        print(f"Speed: {200 / batch_duration:.1f} transactions / second")
        print("-" * 50)
        print(f"AUTOMATION REPORT:")
        print(f"   - Total Processed: {result['total_imported']}")
        print(f"   - Reference Matches: {result['reference_matches']} (Instant)")
        print(f"   - Rule Matches: {result['rule_matches']} (Near Instant)")
        print(f"   - AI Matches: {result['ai_matches']} (Batched Gemini 3 Flash)")
        
        automation_rate = ((result['total_imported'] - result['unmatched']) / result['total_imported']) * 100
        print(f"\nSystem Automation Rate: {automation_rate:.1f}%")
        
        if automation_rate > 90:
            print("STATUS: READY FOR SCALE (High Confidence)")
        else:
            print("STATUS: NEEDS RULE OPTIMIZATION")
    else:
        print(f"ERROR: TEST FAILED: {response.text}")

    print("-" * 50)

if __name__ == "__main__":
    run_scalability_assurance()
