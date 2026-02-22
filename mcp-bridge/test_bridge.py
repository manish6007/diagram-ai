"""
Test script: verify drawio tool calls work via the RUNNING bridge server's /call-tool endpoint.
The bridge must already be running on port 8765.
"""
import requests
import json
import sys

BASE = "http://127.0.0.1:8765"

def test_health():
    print("1️⃣  Testing /health...")
    try:
        r = requests.get(f"{BASE}/health", timeout=5)
        print(f"   Status: {r.status_code}")
        print(f"   Body: {r.json()}")
        return r.status_code == 200
    except Exception as e:
        print(f"   ❌ {e}")
        return False

def test_tools():
    print("\n2️⃣  Testing /tools...")
    try:
        r = requests.get(f"{BASE}/tools", timeout=30)
        print(f"   Status: {r.status_code}")
        data = r.json()
        if 'tools' in data:
            print(f"   Found {len(data['tools'])} tools")
        else:
            print(f"   Body: {json.dumps(data)[:300]}")
        return r.status_code == 200
    except Exception as e:
        print(f"   ❌ {e}")
        return False

def test_call_tool():
    print("\n3️⃣  Testing /call-tool with drawio_get-shape-categories...")
    try:
        r = requests.post(f"{BASE}/call-tool", json={
            "name": "drawio_get-shape-categories",
            "arguments": {}
        }, timeout=30)
        print(f"   Status: {r.status_code}")
        print(f"   Body: {json.dumps(r.json())[:500]}")
        return r.status_code == 200
    except requests.exceptions.Timeout:
        print("   ⏰ TIMEOUT after 30s")
        return False
    except Exception as e:
        print(f"   ❌ {e}")
        return False

def test_add_rectangle():
    print("\n4️⃣  Testing /call-tool with drawio_add-rectangle...")
    try:
        r = requests.post(f"{BASE}/call-tool", json={
            "name": "drawio_add-rectangle",
            "arguments": {
                "x": 100, "y": 100, "width": 60, "height": 60,
                "text": "TEST BOX"
            }
        }, timeout=30)
        print(f"   Status: {r.status_code}")
        print(f"   Body: {json.dumps(r.json())[:500]}")
        return r.status_code == 200
    except requests.exceptions.Timeout:
        print("   ⏰ TIMEOUT after 30s")
        return False
    except Exception as e:
        print(f"   ❌ {e}")
        return False

if __name__ == "__main__":
    if not test_health():
        print("\n❌ Bridge not running. Start it first: python server.py")
        sys.exit(1)
    
    test_tools()
    test_call_tool()
    test_add_rectangle()
    print("\n✅ All tests done.")
