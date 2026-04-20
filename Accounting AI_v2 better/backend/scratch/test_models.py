import os
from dotenv import load_dotenv
from google import genai
from google.genai import errors
import sys

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
api_key = os.environ.get("GEMINI_API_KEY")

if not api_key:
    print("GEMINI_API_KEY not found in .env")
else:
    client = genai.Client(api_key=api_key)
    
    # Exact strings from ListModels
    test_models = [
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-flash-latest"
    ]
    
    for m in test_models:
        try:
            print(f"Testing {m}...")
            # Using generate_content
            response = client.models.generate_content(
                model=m,
                contents="test"
            )
            print(f"OK: {m}")
        except Exception as e:
            print(f"FAIL: {m}: {e}")
