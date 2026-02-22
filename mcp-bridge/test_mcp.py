"""
Direct async test: initialize MCP + call drawio tool in same event loop.
"""
import asyncio
import platform
from fastmcp import Client

async def test():
    is_windows = platform.system() == "Windows"
    npx_cmd = "npx.cmd" if is_windows else "npx"

    config = {
        "mcpServers": {
            "drawio": {
                "transport": "stdio",
                "command": npx_cmd,
                "args": ["-y", "drawio-mcp-server", "-p", "3334"]
            }
        }
    }

    print("1️⃣  Creating client + connecting...")
    client = Client(config)
    
    try:
        await client.__aenter__()
        print("   ✅ Connected")
    except Exception as e:
        print(f"   ❌ Connection failed: {type(e).__name__}: {e}")
        print(f"   This might be because port 3334 is already in use.")
        print(f"   Make sure no other server.py is running.")
        return

    print("\n2️⃣  Listing tools...")
    try:
        tools = await client.list_tools()
        print(f"   Found {len(tools)} tools")
    except Exception as e:
        print(f"   ❌ {type(e).__name__}: {e}")
        return

    print("\n3️⃣  Calling drawio_add-rectangle...")
    try:
        result = await asyncio.wait_for(
            client.call_tool("drawio_add-rectangle", {
                "x": 200, "y": 200, "width": 60, "height": 60,
                "text": "ASYNC TEST"
            }),
            timeout=15
        )
        print(f"   ✅ SUCCESS! Result: {str(result)[:500]}")
    except asyncio.TimeoutError:
        print("   ⏰ TIMEOUT after 15s")
    except Exception as e:
        print(f"   ❌ {type(e).__name__}: {repr(e)}")
        import traceback
        traceback.print_exc()

    print("\n4️⃣  Cleaning up...")
    try:
        await client.__aexit__(None, None, None)
    except:
        pass
    print("Done!")

if __name__ == "__main__":
    asyncio.run(test())
