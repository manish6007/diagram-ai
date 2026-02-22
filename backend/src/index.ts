import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { database } from './db/database';
import { sessionManager } from './services/SessionManager';
import { mcpClient } from './services/MCPClient';
import axios from 'axios';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

import path from 'path';
// Resolve the generated-diagrams folder relative to the root diagram-ai directory
const diagramsDir = path.resolve(process.cwd(), '../mcp-bridge/generated-diagrams');
console.log('Serving diagram files from:', diagramsDir);
app.use('/diagrams', express.static(diagramsDir));

// MCP status endpoint
app.get('/api/status/mcp', async (req, res) => {
  try {
    const statuses = mcpClient.getAllConnectionStatuses();
    res.json({ servers: statuses });
  } catch (error) {
    console.error('Error getting MCP status:', error);
    res.status(500).json({ error: 'Failed to get MCP status' });
  }
});

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:8765';

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId, format } = req.body;
    const apiKey = req.body.apiKey || process.env.OPENAI_API_KEY;

    if (!message || !apiKey) {
      return res.status(400).json({ error: 'Message and API key required' });
    }

    // Create or get session
    let session;
    if (sessionId) {
      session = await sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
    } else {
      session = await sessionManager.createSession();
    }

    // Save user message
    await sessionManager.saveChatMessage(session.id, {
      id: Date.now().toString(),
      sessionId: session.id,
      role: 'user',
      content: message,
      timestamp: new Date()
    });

    // Delegate to Python Strands Agent via HTTP
    // 5 min timeout: agent makes multiple sequential LLM + tool calls
    const agentResult = await axios.post(`${AGENT_URL}/chat`, {
      message,
      apiKey,
      format
    }, { timeout: 300000 });

    const response = agentResult.data.response || 'No response from agent';

    // Save assistant response
    await sessionManager.saveChatMessage(session.id, {
      id: (Date.now() + 1).toString(),
      sessionId: session.id,
      role: 'assistant',
      content: response,
      timestamp: new Date()
    });

    res.json({
      sessionId: session.id,
      response,
      message: 'Diagram generated successfully'
    });
  } catch (error) {
    console.error('Error in chat endpoint:', error instanceof Error ? error.message : error);
    const isTimeout = error instanceof Error && error.message.includes('timeout');
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? 'Diagram generation timed out. Try a simpler diagram.' : 'Failed to generate diagram',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Session endpoints
app.post('/api/session/create', async (req, res) => {
  try {
    const session = await sessionManager.createSession();
    res.json(session);
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.get('/api/session/:id', async (req, res) => {
  try {
    const session = await sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

app.delete('/api/session/:id', async (req, res) => {
  try {
    await sessionManager.deleteSession(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 4000;

// Initialize database and start server
async function startServer() {
  try {
    await database.connect();
    await database.initialize();

    // Initialize MCP connections
    // NOTE: For this MVP, we're skipping direct MCP connections because:
    // 1. Port conflicts with Kiro's MCP servers
    // 2. Kiro already has the MCP servers running
    // 
    // To make this work, you'll need to manually call MCP tools through Kiro
    // or implement an MCP proxy that routes through Kiro's servers.
    console.log('Skipping MCP initialization - use Kiro MCP tools directly');
    console.log('For full functionality, implement MCP proxy or use different ports');

    // Start session cleanup task (runs every hour)
    setInterval(async () => {
      try {
        await sessionManager.cleanupExpiredSessions();
      } catch (error) {
        console.error('Error cleaning up sessions:', error);
      }
    }, 60 * 60 * 1000);

    httpServer.listen(PORT, () => {
      console.log(`Backend server running on http://localhost:${PORT}`);
      console.log(`WebSocket server ready`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
