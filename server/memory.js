import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';

export class MemoryManager {
  constructor(dbPath) {
    // Resolve the correct database path for packaged/portable apps
    const resolvedPath = this._resolveDbPath(dbPath);
    const dir = dirname(resolvedPath);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this._initTables();
  }

  _resolveDbPath(providedPath) {
    // If a valid absolute path is provided and writable, use it
    if (providedPath && !providedPath.includes('app.asar')) {
      return providedPath;
    }

    // Portable mode: use folder next to the executable
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      const portableData = join(process.env.PORTABLE_EXECUTABLE_DIR, 'velle-ai-data');
      if (!existsSync(portableData)) {
        mkdirSync(portableData, { recursive: true });
      }
      return join(portableData, 'velle.db');
    }

    // Standard packaged app: use Electron's userData
    if (app?.isPackaged) {
      const userData = app.getPath('userData');
      if (!existsSync(userData)) {
        mkdirSync(userData, { recursive: true });
      }
      return join(userData, 'velle.db');
    }

    // Development: use local project folder
    const devData = join(process.cwd(), 'data');
    if (!existsSync(devData)) {
      mkdirSync(devData, { recursive: true });
    }
    return join(devData, 'velle.db');
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        personality TEXT DEFAULT 'default',
        timestamp DATETIME DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL DEFAULT 'general',
        content TEXT NOT NULL,
        source TEXT DEFAULT 'explicit',
        importance INTEGER DEFAULT 5 CHECK(importance BETWEEN 1 AND 10),
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        last_accessed DATETIME DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        params TEXT,
        status TEXT DEFAULT 'pending',
        result TEXT,
        timestamp DATETIME DEFAULT (datetime('now','localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
      CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(timestamp);
      CREATE INDEX IF NOT EXISTS idx_mem_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_mem_importance ON memories(importance DESC);
    `);
  }

  // ── Conversations ──

  saveMessage(sessionId, role, content, personality = 'default') {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (session_id, role, content, personality)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(sessionId, role, content, personality);
  }

  getConversationHistory(sessionId, limit = 20) {
    const stmt = this.db.prepare(`
      SELECT role, content, timestamp FROM conversations
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(sessionId, limit).reverse();
  }

  getRecentHistory(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT role, content, personality, timestamp FROM conversations
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(limit).reverse();
  }

  getAllSessions() {
    const stmt = this.db.prepare(`
      SELECT session_id,
             MIN(timestamp) as started,
             MAX(timestamp) as last_message,
             COUNT(*) as message_count,
             personality
      FROM conversations
      GROUP BY session_id
      ORDER BY last_message DESC
    `);
    return stmt.all();
  }

  // ── Memories (facts, preferences, knowledge) ──

  saveMemory(content, category = 'general', importance = 5, source = 'explicit') {
    const existing = this.searchMemories(content.substring(0, 50));
    if (existing.length > 0) {
      for (const mem of existing) {
        if (this._similarity(mem.content, content) > 0.8) {
          this.updateMemory(mem.id, content, importance);
          return { updated: true, id: mem.id };
        }
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO memories (content, category, importance, source)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(content, category, importance, source);
    return { created: true, id: result.lastInsertRowid };
  }

  getMemories(category = null, limit = 20) {
    if (category) {
      const stmt = this.db.prepare(`
        SELECT * FROM memories WHERE category = ?
        ORDER BY importance DESC, last_accessed DESC LIMIT ?
      `);
      return stmt.all(category, limit);
    }
    const stmt = this.db.prepare(`
      SELECT * FROM memories
      ORDER BY importance DESC, last_accessed DESC LIMIT ?
    `);
    return stmt.all(limit);
  }

  searchMemories(query) {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (keywords.length === 0) return [];

    const conditions = keywords.map(() => `LOWER(content) LIKE ?`).join(' OR ');
    const params = keywords.map(k => `%${k}%`);

    const simple = this.db.prepare(`
      SELECT * FROM memories WHERE ${conditions}
      ORDER BY importance DESC LIMIT 10
    `);
    
    try {
      return simple.all(...params);
    } catch {
      return [];
    }
  }

  updateMemory(id, content, importance) {
    const stmt = this.db.prepare(`
      UPDATE memories SET content = ?, importance = ?, last_accessed = datetime('now','localtime')
      WHERE id = ?
    `);
    return stmt.run(content, importance, id);
  }

  deleteMemory(id) {
    const stmt = this.db.prepare(`DELETE FROM memories WHERE id = ?`);
    return stmt.run(id);
  }

  // ── Context Building ──

  buildContext(sessionId, userMessage) {
    const history = this.getConversationHistory(sessionId, 10);
    const relevantMemories = this.searchMemories(userMessage);
    const topMemories = this.getMemories(null, 5);

    const allMemories = [...relevantMemories];
    for (const mem of topMemories) {
      if (!allMemories.find(m => m.id === mem.id)) {
        allMemories.push(mem);
      }
    }

    for (const mem of relevantMemories) {
      this.db.prepare(`
        UPDATE memories SET last_accessed = datetime('now','localtime') WHERE id = ?
      `).run(mem.id);
    }

    return {
      history: history.map(h => ({ role: h.role, content: h.content })),
      memories: allMemories.slice(0, 10)
    };
  }

  // ── Commands ──

  logCommand(action, params, status = 'pending', result = null) {
    const stmt = this.db.prepare(`
      INSERT INTO commands (action, params, status, result)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(action, JSON.stringify(params), status, result);
  }

  // ── Utilities ──

  _similarity(a, b) {
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }

  getStats() {
    const convCount = this.db.prepare('SELECT COUNT(*) as c FROM conversations').get().c;
    const memCount = this.db.prepare('SELECT COUNT(*) as c FROM memories').get().c;
    const sessionCount = this.db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM conversations').get().c;
    return { conversations: convCount, memories: memCount, sessions: sessionCount };
  }

  close() {
    this.db.close();
  }
}