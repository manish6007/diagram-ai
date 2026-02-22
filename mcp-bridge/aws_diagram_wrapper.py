"""
Wrapper to launch aws-diagram-mcp-server with SIGALRM patched for Windows.
Windows doesn't have signal.SIGALRM, so we add a dummy attribute.
"""
import signal
import sys
import platform

if platform.system() == "Windows" and not hasattr(signal, "SIGALRM"):
    # Add a dummy SIGALRM (use a value that won't conflict)
    signal.SIGALRM = 14  # Standard Unix SIGALRM value
    
    # Also patch signal.alarm to be a no-op on Windows
    _original_alarm = getattr(signal, 'alarm', None)
    if _original_alarm is None:
        signal.alarm = lambda seconds: 0
    
    # Patch signal.signal to silently ignore SIGALRM handlers
    _original_signal = signal.signal
    def _patched_signal(signalnum, handler):
        if signalnum == signal.SIGALRM:
            return signal.SIG_DFL  # silently ignore
        return _original_signal(signalnum, handler)
    signal.signal = _patched_signal

# Now run the actual MCP server
from awslabs.aws_diagram_mcp_server.server import main
main()
