import os
from dotenv import load_dotenv
from google import genai

load_dotenv()
api_key = os.environ.get("GEMINI_API_KEY")

if not api_key:
    print("GEMINI_API_KEY not found in .env")
else:
    try:
        client = genai.Client(api_key=api_key)
        print("Available models:")
        for model in client.models.list():
            print(f"- {model.name} (Supported: {model.supported_generation_methods})")
    except Exception as e:
        print(f"Error listing models: {e}")
