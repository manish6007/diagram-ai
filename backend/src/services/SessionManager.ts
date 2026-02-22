import { database } from '../db/database';
import { Session, Message, DiagramData } from '../types';
import { randomUUID } from 'crypto';

interface SessionRow {
  id: string;
  created_at: string;
  last_accessed_at: string;
  chat_history: string;
  current_diagram: string | null;
  config: string;
}

export class SessionManager {
  async createSession(): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      chatHistory: [],
      currentDiagram: null,
      config: {
        provider: 'openai',
        apiKey: '',
        model: 'gpt-4'
      }
    };

    await database.run(
      `INSERT INTO sessions (id, created_at, last_accessed_at, chat_history, current_diagram, config)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.createdAt.toISOString(),
        session.lastAccessedAt.toISOString(),
        JSON.stringify(session.chatHistory),
        null,
        JSON.stringify(session.config)
      ]
    );

    console.log('Session created:', session.id);
    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    const row = await database.get<SessionRow>(
      'SELECT * FROM sessions WHERE id = ?',
      [id]
    );

    if (!row) {
      return null;
    }

    return this.rowToSession(row);
  }

  async updateSession(id: string, data: Partial<Session>): Promise<void> {
    const session = await this.getSession(id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }

    const updated: Session = {
      ...session,
      ...data,
      lastAccessedAt: new Date()
    };

    await database.run(
      `UPDATE sessions 
       SET last_accessed_at = ?, chat_history = ?, current_diagram = ?, config = ?
       WHERE id = ?`,
      [
        updated.lastAccessedAt.toISOString(),
        JSON.stringify(updated.chatHistory),
        updated.currentDiagram ? JSON.stringify(updated.currentDiagram) : null,
        JSON.stringify(updated.config),
        id
      ]
    );

    console.log('Session updated:', id);
  }

  async deleteSession(id: string): Promise<void> {
    await database.run('DELETE FROM sessions WHERE id = ?', [id]);
    console.log('Session deleted:', id);
  }

  async saveChatMessage(sessionId: string, message: Message): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.chatHistory.push(message);
    await this.updateSession(sessionId, { chatHistory: session.chatHistory });
  }

  async saveDiagram(sessionId: string, diagram: DiagramData): Promise<void> {
    await this.updateSession(sessionId, { currentDiagram: diagram });
  }

  async restoreSession(sessionId: string): Promise<Session> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Update last accessed time
    await this.updateSession(sessionId, {});

    return session;
  }

  async cleanupExpiredSessions(): Promise<void> {
    const expiryTime = new Date();
    expiryTime.setHours(expiryTime.getHours() - 24); // 24 hours ago

    const expiredSessions = await database.all<SessionRow>(
      'SELECT id FROM sessions WHERE last_accessed_at < ?',
      [expiryTime.toISOString()]
    );

    for (const row of expiredSessions) {
      await this.deleteSession(row.id);
    }

    console.log(`Cleaned up ${expiredSessions.length} expired sessions`);
  }

  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      createdAt: new Date(row.created_at),
      lastAccessedAt: new Date(row.last_accessed_at),
      chatHistory: JSON.parse(row.chat_history),
      currentDiagram: row.current_diagram ? JSON.parse(row.current_diagram) : null,
      config: JSON.parse(row.config)
    };
  }
}

export const sessionManager = new SessionManager();
