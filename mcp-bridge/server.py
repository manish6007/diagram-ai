"""
FastMCP Bridge Server with Strands Agent (Async version using Quart)
All MCP operations run in the SAME event loop as the web server.
"""
import asyncio
import os
import json
import platform
from quart import Quart, request, jsonify
from fastmcp import Client
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

app = Quart(__name__)

@app.after_request
async def add_cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

# Global MCP client and tools cache
mcp_client = None
mcp_tools_cache = []


async def init_mcp():
    """Initialize MCP client connection to Draw.io and AWS Diagram servers."""
    global mcp_client, mcp_tools_cache
    try:
        is_windows = platform.system() == "Windows"
        npx_cmd = "npx.cmd" if is_windows else "npx"
        drawio_port = os.getenv("DRAWIO_PORT", "3334")

        config = {
            "mcpServers": {
                "drawio": {
                    "transport": "stdio",
                    "command": npx_cmd,
                    "args": ["-y", "drawio-mcp-server", "-p", drawio_port]
                },
                "aws_diagram": {
                    "transport": "stdio",
                    "command": "python",
                    "args": ["aws_diagram_wrapper.py"],
                    "env": {"FASTMCP_LOG_LEVEL": "ERROR"}
                }
            }
        }

        mcp_client = Client(config)
        await mcp_client.__aenter__()

        print("✅ Connected to MCP servers")

        tools = await mcp_client.list_tools()
        mcp_tools_cache = tools
        print(f"📋 Available tools: {len(tools)} tools found")
        for tool in tools:
            print(f"   - {tool.name}")

    except Exception as e:
        print(f"❌ Failed to connect to MCP server: {e}")
        import traceback
        traceback.print_exc()
        raise


def serialize_mcp_result(obj):
    """Helper to convert MCP result objects into JSON serializable structures."""
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, list):
        return [serialize_mcp_result(item) for item in obj]
    if isinstance(obj, dict):
        return {k: serialize_mcp_result(v) for k, v in obj.items()}
    if hasattr(obj, 'content'):
        return serialize_mcp_result(obj.content)
    if hasattr(obj, 'text'):
        return obj.text
    if hasattr(obj, '__dict__'):
        return serialize_mcp_result(obj.__dict__)
    return str(obj)


# ── Routes ──────────────────────────────────────────────

@app.route('/health', methods=['GET'])
async def health():
    return jsonify({
        'status': 'ok',
        'mcp_connected': mcp_client is not None,
        'tools_loaded': len(mcp_tools_cache)
    })


@app.route('/tools', methods=['GET'])
async def list_tools_route():
    if not mcp_client:
        return jsonify({'error': 'MCP not connected'}), 500
    try:
        tools = await mcp_client.list_tools()
        tools_list = [
            {
                'name': tool.name,
                'description': tool.description,
                'inputSchema': tool.inputSchema
            }
            for tool in tools
        ]
        return jsonify({'tools': tools_list})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/call-tool', methods=['POST'])
async def call_tool():
    print(f"DEBUG: ENTERING /call-tool")
    if not mcp_client:
        return jsonify({'error': 'MCP not connected'}), 500
    data = await request.json
    tool_name = data.get('name')
    arguments = data.get('arguments', {})
    print(f"DEBUG: CALLING: {tool_name} with {str(arguments)[:200]}")
    if not tool_name:
        return jsonify({'error': 'Tool name required'}), 400
    try:
        result = await asyncio.wait_for(
            mcp_client.call_tool(tool_name, arguments),
            timeout=120
        )
        result_data = serialize_mcp_result(result)
        print(f"DEBUG: SUCCESS: {tool_name} -> {str(result_data)[:300]}")
        return jsonify({'result': result_data})
    except asyncio.TimeoutError:
        print(f"DEBUG: TIMEOUT: {tool_name}")
        return jsonify({'error': f"Tool '{tool_name}' timed out"}), 504
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"DEBUG: ERROR: {tool_name}\n{tb}")
        return jsonify({'error': f"{type(e).__name__}: {str(e) or repr(e)}", 'traceback': tb}), 500


@app.errorhandler(500)
async def handle_500(error):
    import traceback
    tb = traceback.format_exc()
    print(f"DEBUG: GLOBAL 500 HANDLER: {type(error).__name__}: {repr(error)}\n{tb}")
    return jsonify({'error': f"Internal: {type(error).__name__}: {str(error) or repr(error)}", "traceback": tb}), 500


@app.route('/chat', methods=['POST'])
async def chat():
    """
    Agentic chat endpoint powered by Strands Agent.
    Body: { "message": "...", "apiKey": "sk-..." }
    Returns: { "response": "..." }
    """
    data = (await request.json) or {}
    message = data.get('message', '')
    api_key = data.get('apiKey', '') or os.getenv('OPENAI_API_KEY', '')

    if not message:
        return jsonify({'error': 'message is required'}), 400
    if not api_key:
        return jsonify({'error': 'apiKey is required. Set OPENAI_API_KEY or pass in request.'}), 400

    try:
        from strands import Agent
        from strands.models.openai import OpenAIModel
        from strands import tool as strands_tool
        import inspect

        model = OpenAIModel(
            client_args={"api_key": api_key},
            model_id="gpt-4o",
        )

        # Build @tool-decorated functions for each MCP tool
        # These tool functions use asyncio to call MCP in the same event loop
        tool_list = []
        loop = asyncio.get_event_loop()

        for t in mcp_tools_cache:
            tool_name = t.name
            tool_desc = t.description or tool_name
            schema = t.inputSchema if hasattr(t, 'inputSchema') else {}

            def make_tool_fn(name, desc, input_schema):
                props = input_schema.get("properties", {})
                required_params = input_schema.get("required", [])

                def tool_fn(**kwargs) -> str:
                    """Proxy MCP tool call."""
                    filtered = {k: v for k, v in kwargs.items() if v is not None}
                    if name.startswith("aws_diagram") and platform.system() == "Windows":
                        filtered["timeout"] = 0

                    print(f"\n🔧 Calling tool: {name}")
                    print(f"   Args: {json.dumps(filtered, default=str)[:200]}")
                    try:
                        # Use the event loop to call the async tool
                        future = asyncio.run_coroutine_threadsafe(
                            asyncio.wait_for(
                                mcp_client.call_tool(name, filtered),
                                timeout=60
                            ),
                            loop
                        )
                        result = future.result(timeout=90)
                        serialized = serialize_mcp_result(result)
                        result_str = json.dumps(serialized) if not isinstance(serialized, str) else serialized
                        print(f"   ✅ Result: {result_str[:200]}")
                        return result_str
                    except asyncio.TimeoutError:
                        print(f"   ⏰ TIMEOUT: Tool '{name}' timed out")
                        return json.dumps({"error": f"Tool '{name}' timed out."})
                    except Exception as e:
                        print(f"   ❌ ERROR: Tool '{name}' failed: {str(e)}")
                        return json.dumps({"error": f"Tool '{name}' failed: {str(e)}"})

                # Build proper function signature
                parameters = []
                for pname, pinfo in props.items():
                    json_type = pinfo.get("type", "string")
                    if not json_type and "anyOf" in pinfo:
                        for variant in pinfo["anyOf"]:
                            if variant.get("type") != "null":
                                json_type = variant.get("type", "string")
                                break

                    py_type = str
                    if json_type == "integer":
                        py_type = int
                    elif json_type == "number":
                        py_type = float
                    elif json_type == "boolean":
                        py_type = bool

                    default = inspect.Parameter.empty if pname in required_params else None
                    parameters.append(inspect.Parameter(
                        pname,
                        inspect.Parameter.POSITIONAL_OR_KEYWORD,
                        default=default,
                        annotation=py_type,
                    ))

                tool_fn.__signature__ = inspect.Signature(parameters, return_annotation=str)
                tool_fn.__name__ = name
                tool_fn.__qualname__ = name

                doc_lines = [desc]
                param_docs = []
                for pname, pinfo in props.items():
                    pdesc = pinfo.get("description", "")
                    if pdesc:
                        param_docs.append(f"    {pname}: {pdesc}")
                if param_docs:
                    doc_lines.append("\nArgs:")
                    doc_lines.extend(param_docs)
                tool_fn.__doc__ = "\n".join(doc_lines)

                return strands_tool(name=name, description=desc)(tool_fn)

            tool_list.append(make_tool_fn(tool_name, tool_desc, schema))

        format_choice = data.get('format', 'drawio')

        # Filter tools and swap prompt based on user preference
        if format_choice == 'png':
            active_tools = [t for t in tool_list if not getattr(t, '__name__', getattr(t, 'name', '')).startswith('drawio')]
            system_prompt = """You are an expert diagram architect. The user wants a static PNG diagram generated via Python.
You MUST use the aws_diagram tools (get_diagram_examples, list_icons, generate_diagram) to build the diagram.
DO NOT use Draw.io tools.

CRITICAL CODE RULES:
- DO NOT use any `import` or `from ... import` statements. The environment already pre-imports all diagram providers and services.
- Start your code immediately with `with Diagram(...):`.
- Use the exact names from `list_icons` directly (e.g., `S3`, `Lambda`, `Glue`).
- If you need to use Windows file paths (like the workspace_dir), you MUST use raw strings `r"C:\\path"` or replace backslashes with forward slashes `"C:/path"` to prevent unicode escape errors.

WORKFLOW:
1. Use get_diagram_examples to understand the syntax for AWS architecture diagrams.
2. Use list_icons to find the exact names for the required AWS icons.
3. Write the Python code and call generate_diagram. Ensure you pass workspace_dir to save it appropriately.
Return a summary of the generated diagram and the saved file path."""
        else:
            active_tools = [t for t in tool_list if getattr(t, '__name__', getattr(t, 'name', '')).startswith('drawio')]
            system_prompt = """You are an expert diagram architect that creates professional AWS diagrams DIRECTLY in Draw.io.
You MUST use the Draw.io MCP tools (prefixed with drawio_) to build diagrams interactively.
Do NOT use the aws_diagram tools — the user wants Draw.io diagrams.

## WORKFLOW — Create diagrams step by step:

### Step 1: Create Components with drawio_add-rectangle
Use `drawio_add-rectangle` to create each component. Use the `style` param with mxgraph styles for AWS icons.

IMPORTANT: Create shapes ONE AT A TIME. Wait for each tool call to succeed before the next.

AWS Icon Style Guide:
| Component      | Style String |
|----------------|-------------|
| User           | "shape=mxgraph.aws4.user;verticalLabelPosition=bottom;align=center;verticalAlign=top;html=1;fontColor=#232F3E;fillColor=#D2D3D3;strokeColor=none;aspect=fixed;" |
| EC2            | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;fontColor=#232F3E;fillColor=#ED7100;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| RDS            | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.rds;fontColor=#232F3E;fillColor=#3333FF;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| S3             | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;fontColor=#232F3E;fillColor=#009900;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| Lambda         | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fontColor=#232F3E;fillColor=#ED7100;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| API Gateway    | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;fontColor=#232F3E;fillColor=#8C4FFF;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| Glue           | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.glue;fontColor=#232F3E;fillColor=#8C4FFF;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| SNS            | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sns;fontColor=#232F3E;fillColor=#CC2264;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| SQS            | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sqs;fontColor=#232F3E;fillColor=#CC2264;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| CloudWatch     | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudwatch;fontColor=#232F3E;fillColor=#CC2264;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| DynamoDB       | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;fontColor=#232F3E;fillColor=#3333FF;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| Step Functions | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.step_functions;fontColor=#232F3E;fillColor=#CC2264;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| Bedrock        | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;fontColor=#232F3E;fillColor=#01A88D;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| VPC            | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.vpc;fontColor=#232F3E;fillColor=#8C4FFF;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| Route 53       | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.route_53;fontColor=#232F3E;fillColor=#8C4FFF;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| Cognito        | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cognito;fontColor=#232F3E;fillColor=#DD344C;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| ECS            | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ecs;fontColor=#232F3E;fillColor=#ED7100;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| EKS            | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.eks;fontColor=#232F3E;fillColor=#ED7100;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| KMS            | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.kms;fontColor=#232F3E;fillColor=#DD344C;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| Kinesis        | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.kinesis;fontColor=#232F3E;fillColor=#8C4FFF;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |
| Redshift       | "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.redshift;fontColor=#232F3E;fillColor=#3333FF;strokeColor=#ffffff;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;aspect=fixed;" |

Grid: x increments of 200 (100, 300, 500...), y increments of 150. Icons: width=60, height=60.

### Step 2: Connect with drawio_add-edge
- source_id and target_id from Step 1
- style: "endArrow=classic;strokeWidth=2;strokeColor=#333333;"

CRITICAL: Create shapes ONE AT A TIME. Never call multiple drawio tools in parallel."""

        # Run agent in a thread so it doesn't block the event loop
        def run_agent():
            agent = Agent(model=model, system_prompt=system_prompt, tools=active_tools)
            result = agent(message)
            return str(result)

        response_text = await asyncio.to_thread(run_agent)

        return jsonify({'response': response_text})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ── Startup ──────────────────────────────────────────────

async def main():
    print("🚀 Starting MCP Bridge Server (Quart async)...")

    # Initialize MCP in the SAME event loop as the web server
    await init_mcp()

    print("\n📍 Routes: /health, /tools, /call-tool, /chat")
    port = int(os.getenv('PORT', 8765))
    print(f"\n🌐 Starting HTTP server on http://localhost:{port}")

    # Run Quart
    await app.run_task(host='127.0.0.1', port=port)

if __name__ == '__main__':
    asyncio.run(main())
