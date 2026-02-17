// ═══════════════════════════════════════════════════════════════
//  VELLE.AI — Advanced Features Module
//  • Proactive reminders with scheduling
//  • Mood tracking system
//  • Daily conversation summaries
//  • Auto-tagging memories with categories
//  • Local file search assistant
//  • Personal journal with prompts, streaks & reflection
// ═══════════════════════════════════════════════════════════════

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, extname, basename, relative } from 'path';
import { homedir } from 'os';

// ═══════════════════════════════════
//  1. PROACTIVE REMINDERS
// ═══════════════════════════════════

export class ReminderEngine {
  constructor(db) {
    this.db = db;
    this.timers = new Map();   // active setTimeout refs
    this.listeners = [];       // ws connections to notify
    this._initTable();
  }

  _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        due_at DATETIME NOT NULL,
        repeat TEXT DEFAULT NULL,
        fired INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_rem_due ON reminders(due_at);
    `);
  }

  addListener(ws) {
    this.listeners.push(ws);
    // Clean dead connections
    this.listeners = this.listeners.filter(w => w.readyState === 1);
  }

  add(content, dueAt, repeat = null) {
    const stmt = this.db.prepare(
      'INSERT INTO reminders (content, due_at, repeat) VALUES (?, ?, ?)'
    );
    const result = stmt.run(content, dueAt, repeat);
    const id = result.lastInsertRowid;
    this._schedule({ id, content, due_at: dueAt, repeat });
    return { id, content, due_at: dueAt, repeat };
  }

  remove(id) {
    this.db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
    if (this.timers.has(id)) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
    }
    return { deleted: true, id };
  }

  getAll() {
    return this.db.prepare(
      'SELECT * FROM reminders WHERE fired = 0 ORDER BY due_at ASC'
    ).all();
  }

  getUpcoming(minutes = 60) {
    return this.db.prepare(`
      SELECT * FROM reminders
      WHERE fired = 0 AND due_at <= datetime('now','localtime','+${minutes} minutes')
      ORDER BY due_at ASC
    `).all();
  }

  // Schedule all pending reminders on startup
  startAll() {
    const pending = this.getAll();
    for (const r of pending) this._schedule(r);
    console.log(`[Reminders] ${pending.length} pending reminders loaded`);
  }

  _schedule(reminder) {
    const now = Date.now();
    const dueMs = new Date(reminder.due_at).getTime();
    const delay = Math.max(0, dueMs - now);

    // Don't schedule if more than 24h out — re-check periodically
    if (delay > 86400000) return;

    const timer = setTimeout(() => {
      this._fire(reminder);
    }, delay);

    this.timers.set(reminder.id, timer);
  }

  _fire(reminder) {
    // Mark as fired
    this.db.prepare('UPDATE reminders SET fired = 1 WHERE id = ?').run(reminder.id);
    this.timers.delete(reminder.id);

    // Notify all connected clients
    const msg = JSON.stringify({
      type: 'reminder_fired',
      id: reminder.id,
      content: reminder.content,
      due_at: reminder.due_at,
    });

    for (const ws of this.listeners) {
      try { if (ws.readyState === 1) ws.send(msg); } catch {}
    }

    console.log(`[Reminder] FIRED: ${reminder.content}`);

    // Handle repeating reminders
    if (reminder.repeat) {
      const next = this._nextOccurrence(reminder.due_at, reminder.repeat);
      if (next) {
        this.add(reminder.content, next, reminder.repeat);
      }
    }
  }

  _nextOccurrence(dueAt, repeat) {
    const d = new Date(dueAt);
    switch (repeat) {
      case 'daily':   d.setDate(d.getDate() + 1); break;
      case 'weekly':  d.setDate(d.getDate() + 7); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
      case 'hourly':  d.setHours(d.getHours() + 1); break;
      default: return null;
    }
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }

  // Periodic re-check for far-future reminders
  startPeriodicCheck(intervalMs = 3600000) {
    setInterval(() => this.startAll(), intervalMs);
  }
}

// Parse natural language time like "in 10 minutes", "tomorrow at 3pm", "at 5:30"
export function parseReminderTime(text) {
  const now = new Date();
  let due = null;

  // Helper: format Date as local "YYYY-MM-DD HH:MM:SS"
  const toLocal = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // "in X minutes/hours/seconds"
  const inMatch = text.match(/in\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|seconds?|secs?|days?)/i);
  if (inMatch) {
    due = new Date(now);
    const n = parseInt(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    if (unit.startsWith('min')) due.setMinutes(due.getMinutes() + n);
    else if (unit.startsWith('h')) due.setHours(due.getHours() + n);
    else if (unit.startsWith('s')) due.setSeconds(due.getSeconds() + n);
    else if (unit.startsWith('d')) due.setDate(due.getDate() + n);
    return toLocal(due);
  }

  // "at HH:MM" or "at H:MMam/pm"
  const atMatch = text.match(/at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (atMatch) {
    due = new Date(now);
    let h = parseInt(atMatch[1]);
    const m = parseInt(atMatch[2]);
    const ampm = atMatch[3]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    due.setHours(h, m, 0, 0);
    if (due <= now) due.setDate(due.getDate() + 1); // next day if past
    return toLocal(due);
  }

  // "tomorrow"
  if (/tomorrow/i.test(text)) {
    due = new Date(now);
    due.setDate(due.getDate() + 1);
    const timeMatch = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1]);
      if (timeMatch[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
      due.setHours(h, parseInt(timeMatch[2]), 0, 0);
    } else {
      due.setHours(9, 0, 0, 0); // default 9am
    }
    return toLocal(due);
  }

  return null;
}

// Detect repeat pattern
export function parseRepeat(text) {
  if (/every\s*day|daily/i.test(text)) return 'daily';
  if (/every\s*week|weekly/i.test(text)) return 'weekly';
  if (/every\s*month|monthly/i.test(text)) return 'monthly';
  if (/every\s*hour|hourly/i.test(text)) return 'hourly';
  return null;
}


// ═══════════════════════════════════
//  2. MOOD TRACKING SYSTEM
// ═══════════════════════════════════

export class MoodTracker {
  constructor(db) {
    this.db = db;
    this._initTable();
  }

  _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mood_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        score REAL NOT NULL,
        label TEXT NOT NULL,
        triggers TEXT,
        session_id TEXT,
        timestamp DATETIME DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_mood_ts ON mood_log(timestamp);
    `);
  }

  // Analyze sentiment of a message, return -1.0 to 1.0
  analyzeSentiment(text) {
    const lower = text.toLowerCase();
    const posWords = [
      'happy','great','awesome','love','excellent','amazing','wonderful','fantastic',
      'good','nice','thanks','thank','perfect','excited','glad','fun','enjoy','beautiful',
      'brilliant','cool','sweet','yes','yay','haha','lol','appreciate','helpful','impressive'
    ];
    const negWords = [
      'sad','angry','frustrated','hate','terrible','awful','horrible','bad','worse','worst',
      'annoyed','upset','disappointed','depressed','anxious','worried','stressed','tired',
      'sick','boring','stupid','ugh','damn','crap','fail','sucks','broken','lost','confused'
    ];
    const strongPos = ['love','amazing','fantastic','brilliant','perfect','excited'];
    const strongNeg = ['hate','terrible','depressed','awful','horrible'];

    let score = 0;
    const words = lower.split(/\s+/);
    for (const w of words) {
      if (strongPos.some(p => w.includes(p))) score += 0.3;
      else if (posWords.some(p => w.includes(p))) score += 0.15;
      if (strongNeg.some(n => w.includes(n))) score -= 0.3;
      else if (negWords.some(n => w.includes(n))) score -= 0.15;
    }

    // Emoji analysis
    const posEmojis = /[😀😁😂🤣😃😄😅😆😊😍🥰😘🤗🎉🎊🚀💪✅👍❤️🔥⭐]/g;
    const negEmojis = /[😢😭😤😡🤬😰😥😞😔💀☠️👎😵😖😫😩]/g;
    score += ((text.match(posEmojis) || []).length * 0.1);
    score -= ((text.match(negEmojis) || []).length * 0.1);

    return Math.max(-1, Math.min(1, score));
  }

  scoreToLabel(score) {
    if (score >= 0.5) return '😄 great';
    if (score >= 0.2) return '🙂 good';
    if (score >= -0.1) return '😐 neutral';
    if (score >= -0.3) return '😕 meh';
    if (score >= -0.5) return '😞 low';
    return '😢 rough';
  }

  // Log mood from a conversation message
  track(text, sessionId = null) {
    const score = this.analyzeSentiment(text);
    const label = this.scoreToLabel(score);

    // Extract potential mood triggers
    const triggers = [];
    if (/work|job|boss|meeting|deadline/i.test(text)) triggers.push('work');
    if (/money|pay|bill|broke|expensive/i.test(text)) triggers.push('money');
    if (/friend|family|relationship|partner/i.test(text)) triggers.push('relationships');
    if (/health|sick|tired|sleep|exercise/i.test(text)) triggers.push('health');
    if (/code|bug|deploy|server|error/i.test(text)) triggers.push('coding');
    if (/stock|market|trade|portfolio|crypto/i.test(text)) triggers.push('markets');

    this.db.prepare(`
      INSERT INTO mood_log (score, label, triggers, session_id)
      VALUES (?, ?, ?, ?)
    `).run(score, label, triggers.join(','), sessionId);

    return { score: +score.toFixed(2), label, triggers };
  }

  // Get mood history
  getHistory(days = 7) {
    return this.db.prepare(`
      SELECT * FROM mood_log
      WHERE timestamp >= datetime('now','localtime','-${days} days')
      ORDER BY timestamp ASC
    `).all();
  }

  // Get current mood (average of last N messages)
  getCurrentMood(n = 5) {
    const recent = this.db.prepare(`
      SELECT score, label, triggers FROM mood_log
      ORDER BY timestamp DESC LIMIT ?
    `).all(n);

    if (!recent.length) return { score: 0, label: '😐 neutral', trend: 'stable' };

    const avg = recent.reduce((s, r) => s + r.score, 0) / recent.length;
    const label = this.scoreToLabel(avg);

    // Trend: compare first half vs second half
    const half = Math.floor(recent.length / 2);
    const oldAvg = recent.slice(half).reduce((s, r) => s + r.score, 0) / (recent.length - half);
    const newAvg = recent.slice(0, half || 1).reduce((s, r) => s + r.score, 0) / (half || 1);
    let trend = 'stable';
    if (newAvg - oldAvg > 0.15) trend = 'improving 📈';
    else if (oldAvg - newAvg > 0.15) trend = 'declining 📉';

    return { score: +avg.toFixed(2), label, trend, samples: recent.length };
  }

  // Daily mood summary
  getDailySummary() {
    return this.db.prepare(`
      SELECT date(timestamp) as day,
             AVG(score) as avg_score,
             MIN(score) as low,
             MAX(score) as high,
             COUNT(*) as entries,
             GROUP_CONCAT(DISTINCT triggers) as all_triggers
      FROM mood_log
      WHERE timestamp >= datetime('now','localtime','-7 days')
      GROUP BY date(timestamp)
      ORDER BY day DESC
    `).all();
  }
}


// ═══════════════════════════════════
//  3. DAILY SUMMARIES
// ═══════════════════════════════════

export class SummaryEngine {
  constructor(db, ollamaUrl, model) {
    this.db = db;
    this.ollamaUrl = ollamaUrl;
    this.model = model;
    this._initTable();
  }

  _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        summary TEXT NOT NULL,
        topics TEXT,
        message_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now','localtime'))
      );
    `);
  }

  // Get conversations for a specific day
  getDayConversations(date = null) {
    const d = date || new Date().toISOString().slice(0, 10);
    return this.db.prepare(`
      SELECT role, content, personality, timestamp FROM conversations
      WHERE date(timestamp) = ?
      ORDER BY timestamp ASC
    `).all(d);
  }

  // Generate summary using the local LLM
  async generateSummary(date = null) {
    const d = date || new Date().toISOString().slice(0, 10);

    // Check if already generated
    const existing = this.db.prepare(
      'SELECT * FROM daily_summaries WHERE date = ?'
    ).get(d);
    if (existing) return existing;

    const convos = this.getDayConversations(d);
    if (convos.length < 2) return { date: d, summary: 'Too few messages to summarize.', message_count: convos.length };

    // Build transcript
    const transcript = convos.map(c =>
      `[${c.role}] ${c.content.substring(0, 200)}`
    ).join('\n');

    // Extract topics locally (no LLM needed for basic extraction)
    const topics = this._extractTopics(convos);

    // Try LLM summary, fall back to extractive
    let summary;
    try {
      summary = await this._llmSummarize(transcript, d);
    } catch {
      summary = this._extractiveSummary(convos);
    }

    // Save
    this.db.prepare(`
      INSERT OR REPLACE INTO daily_summaries (date, summary, topics, message_count)
      VALUES (?, ?, ?, ?)
    `).run(d, summary, topics.join(', '), convos.length);

    return { date: d, summary, topics, message_count: convos.length };
  }

  async _llmSummarize(transcript, date) {
    const resp = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{
          role: 'user',
          content: `Summarize this conversation from ${date} in 2-4 sentences. Focus on key topics discussed, decisions made, and any action items:\n\n${transcript.substring(0, 3000)}`
        }],
        stream: false,
        options: { temperature: 0.3 }
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await resp.json();
    return data.message?.content?.trim() || this._extractiveSummary(transcript);
  }

  _extractiveSummary(convos) {
    const userMsgs = convos.filter(c => c.role === 'user').map(c => c.content);
    if (userMsgs.length === 0) return 'No user messages.';

    const firstTopic = userMsgs[0].substring(0, 100);
    const msgCount = convos.length;
    const userCount = userMsgs.length;
    return `${userCount} messages sent across ${msgCount} total exchanges. Started with: "${firstTopic}..."`;
  }

  _extractTopics(convos) {
    const text = convos.map(c => c.content).join(' ').toLowerCase();
    const topicKeywords = {
      'coding': /code|programming|function|debug|deploy|git|api|bug|script/,
      'stocks': /stock|market|trade|portfolio|ticker|price|bull|bear/,
      'work': /meeting|deadline|project|client|boss|team|sprint/,
      'personal': /family|friend|dinner|weekend|vacation|hobby/,
      'tech': /computer|server|hardware|software|install|config/,
      'learning': /learn|study|course|tutorial|understand|explain/,
      'creative': /write|design|draw|music|art|build|create/,
    };

    const found = [];
    for (const [topic, pattern] of Object.entries(topicKeywords)) {
      if (pattern.test(text)) found.push(topic);
    }
    return found.length ? found : ['general'];
  }

  // Get recent summaries
  getRecent(days = 7) {
    return this.db.prepare(`
      SELECT * FROM daily_summaries
      ORDER BY date DESC LIMIT ?
    `).all(days);
  }
}


// ═══════════════════════════════════
//  4. AUTO-TAGGING MEMORIES
// ═══════════════════════════════════

const CATEGORY_RULES = [
  { category: 'preference',   patterns: [/i (?:really )?(?:like|love|enjoy|prefer|hate|dislike)\b/i, /favorite\b/i, /prefer\b/i] },
  { category: 'personal',     patterns: [/my (?:name|age|birthday|family|wife|husband|partner|kid|child|dog|cat)\b/i, /i (?:am|was) born/i, /i live/i] },
  { category: 'work',         patterns: [/i work (?:at|for|on|as)\b/i, /my (?:job|role|title|company|boss|team)\b/i, /salary|coworker|office/i] },
  { category: 'tech',         patterns: [/python|javascript|react|node|api|docker|linux|windows|server|database|gpu|cuda/i] },
  { category: 'finance',      patterns: [/stock|ticker|portfolio|invest|trade|crypto|bitcoin|market|etf|401k|budget/i] },
  { category: 'health',       patterns: [/health|workout|exercise|diet|sleep|medication|doctor|allergy|weight/i] },
  { category: 'location',     patterns: [/i live (?:in|at|near)\b/i, /my (?:address|city|zip|country|state)\b/i, /moved to/i] },
  { category: 'schedule',     patterns: [/every (?:day|week|month|morning|evening)\b/i, /routine|schedule|usually|always/i] },
  { category: 'goal',         patterns: [/i want to|my goal|planning to|hoping to|going to|need to learn/i] },
  { category: 'project',      patterns: [/working on|building|my project|side project|app|website|game/i] },
];

export function autoTagMemory(content) {
  const tags = [];
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some(p => p.test(content))) {
      tags.push(rule.category);
    }
  }
  return tags.length ? tags : ['general'];
}

// Auto-determine importance (1-10)
export function autoImportance(content, category) {
  let score = 5;

  // Personal identity facts are high importance
  if (/my name is|i am called/i.test(content)) score = 9;
  if (/birthday|born on/i.test(content)) score = 8;

  // Preferences
  if (category === 'preference') score = 6;

  // Goals and projects
  if (category === 'goal' || category === 'project') score = 7;

  // Location
  if (category === 'location') score = 7;

  // Work info
  if (category === 'work') score = 7;

  // Short content is less important
  if (content.length < 20) score = Math.max(3, score - 2);

  // Very specific content is more important
  if (content.includes('@') || content.includes('http') || /\d{3,}/.test(content)) score = Math.min(10, score + 1);

  return Math.max(1, Math.min(10, score));
}


// ═══════════════════════════════════
//  5. LOCAL FILE SEARCH
// ═══════════════════════════════════

export class FileSearchEngine {
  constructor() {
    this.indexCache = new Map();  // path -> { files, indexed_at }
    this.maxDepth = 5;
    this.maxFiles = 5000;

    // File types to index content of
    this.textExtensions = new Set([
      '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.rs',
      '.html', '.css', '.scss', '.yaml', '.yml', '.toml', '.ini', '.cfg',
      '.env', '.sh', '.bat', '.ps1', '.sql', '.csv', '.xml', '.svg',
      '.c', '.cpp', '.h', '.hpp', '.java', '.go', '.rb', '.php',
      '.log', '.gitignore', '.dockerfile', '.makefile',
    ]);

    // Directories to skip
    this.skipDirs = new Set([
      'node_modules', '.git', '.next', '.nuxt', '__pycache__', '.cache',
      'dist', 'build', '.vscode', '.idea', 'vendor', 'target',
      '.npm', 'coverage', '.pytest_cache', 'venv', '.env',
    ]);
  }

  // Search for files by name or content
  search(query, searchPaths = null) {
    const paths = searchPaths || this._defaultSearchPaths();
    const results = [];
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter(w => w.length > 1);

    for (const basePath of paths) {
      if (!existsSync(basePath)) continue;
      this._walkDir(basePath, 0, (filePath, stats) => {
        if (results.length >= 50) return false; // stop

        const name = basename(filePath).toLowerCase();
        const relPath = relative(basePath, filePath);

        // Filename match
        const nameMatch = keywords.some(k => name.includes(k));

        // Path match
        const pathMatch = keywords.some(k => relPath.toLowerCase().includes(k));

        if (nameMatch || pathMatch) {
          results.push({
            path: filePath,
            name: basename(filePath),
            relative: relPath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            match_type: nameMatch ? 'filename' : 'path',
            snippet: null,
          });
        }

        return true; // continue
      });
    }

    // If few results, try content search on text files
    if (results.length < 10 && keywords.length > 0) {
      for (const basePath of paths) {
        if (!existsSync(basePath)) continue;
        this._walkDir(basePath, 0, (filePath, stats) => {
          if (results.length >= 50) return false;
          if (stats.size > 500000) return true; // skip large files
          if (results.some(r => r.path === filePath)) return true; // already found

          const ext = extname(filePath).toLowerCase();
          if (!this.textExtensions.has(ext)) return true;

          try {
            const content = readFileSync(filePath, 'utf-8');
            const contentLower = content.toLowerCase();
            if (keywords.some(k => contentLower.includes(k))) {
              // Extract snippet around match
              const idx = contentLower.indexOf(keywords[0]);
              const start = Math.max(0, idx - 50);
              const snippet = content.substring(start, start + 150).replace(/\n/g, ' ').trim();

              results.push({
                path: filePath,
                name: basename(filePath),
                relative: relative(basePath, filePath),
                size: stats.size,
                modified: stats.mtime.toISOString(),
                match_type: 'content',
                snippet: snippet,
              });
            }
          } catch { /* skip unreadable files */ }

          return true;
        });
      }
    }

    // Sort: filename matches first, then by modified date
    results.sort((a, b) => {
      if (a.match_type === 'filename' && b.match_type !== 'filename') return -1;
      if (b.match_type === 'filename' && a.match_type !== 'filename') return 1;
      return new Date(b.modified) - new Date(a.modified);
    });

    return results.slice(0, 30);
  }

  _walkDir(dir, depth, callback) {
    if (depth > this.maxDepth) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (this.skipDirs.has(entry.name)) continue;
          this._walkDir(fullPath, depth + 1, callback);
        } else if (entry.isFile()) {
          try {
            const stats = statSync(fullPath);
            const cont = callback(fullPath, stats);
            if (cont === false) return;
          } catch { /* skip inaccessible files */ }
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  _defaultSearchPaths() {
    const home = homedir();
    const paths = [
      join(home, 'Desktop'),
      join(home, 'Documents'),
      join(home, 'Downloads'),
      join(home, 'Projects'),
      join(home, 'Code'),
      join(home, 'Development'),
      join(home, 'repos'),
      join(home, 'src'),
    ];
    return paths.filter(p => existsSync(p));
  }

  // Get stats about searchable directories
  getSearchableInfo() {
    const paths = this._defaultSearchPaths();
    return paths.map(p => ({
      path: p,
      exists: existsSync(p),
    }));
  }
}

// Format file search results
export function formatFileResults(results, query) {
  if (!results.length) return `No files found matching "${query}".`;

  let text = `📁 **File Search: "${query}"** — ${results.length} result${results.length > 1 ? 's' : ''}\n\n`;

  for (let i = 0; i < Math.min(results.length, 15); i++) {
    const r = results[i];
    const sizeStr = r.size < 1024 ? `${r.size}B`
      : r.size < 1048576 ? `${(r.size / 1024).toFixed(1)}KB`
      : `${(r.size / 1048576).toFixed(1)}MB`;

    const icon = r.match_type === 'content' ? '📄' : '📁';
    text += `${icon} **${r.name}** (${sizeStr})\n`;
    text += `   \`${r.relative || r.path}\`\n`;
    if (r.snippet) {
      text += `   _...${r.snippet}..._\n`;
    }
  }

  if (results.length > 15) {
    text += `\n...and ${results.length - 15} more results.`;
  }

  return text;
}


// ═══════════════════════════════════
//  6. PERSONAL JOURNAL
// ═══════════════════════════════════

const JOURNAL_PROMPTS = [
  "What's one thing you accomplished today, no matter how small?",
  "What's taking up the most mental space right now?",
  "Describe your energy level today in one word. Why?",
  "What are you grateful for today?",
  "What would make tomorrow better than today?",
  "What's something you learned recently?",
  "If today had a title, what would it be?",
  "What's one thing you'd tell your past self from a week ago?",
  "What's a problem you're stuck on? Write it out.",
  "Rate your day 1-10. What would bump it up one point?",
  "What did you spend the most time on today? Was it worth it?",
  "Who had the biggest impact on your day?",
  "What's something you've been putting off?",
  "Write one sentence about how you're really feeling right now.",
  "What's a win you haven't celebrated yet?",
  "What drained your energy today? What charged it?",
  "If you could redo one thing today, what would it be?",
  "What's exciting you about the future right now?",
  "What habit are you trying to build or break?",
  "Describe your mood in three emojis. Then explain why.",
  "What's one thing you want to remember about today?",
  "What would your ideal tomorrow look like?",
  "What's the bravest thing you did today?",
  "Write a quick note to your future self reading this.",
  "What pattern are you noticing in your life lately?",
  "What are you avoiding? Why?",
  "What brought you joy today, even briefly?",
  "What's one thing you're proud of this week?",
  "If your week was a movie, what genre would it be?",
  "What do you need more of in your life right now?",
];

export class JournalEngine {
  constructor(db) {
    this.db = db;
    this._initTable();
  }

  _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        prompt TEXT,
        mood_score REAL,
        mood_label TEXT,
        tags TEXT,
        pinned INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_journal_date ON journal(created_at);
      CREATE INDEX IF NOT EXISTS idx_journal_pinned ON journal(pinned);
    `);
  }

  // Write a new entry
  write(content, prompt = null, moodScore = null, moodLabel = null) {
    const tags = this._autoTag(content).join(',');
    const stmt = this.db.prepare(`
      INSERT INTO journal (content, prompt, mood_score, mood_label, tags)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(content, prompt, moodScore, moodLabel, tags);
    return {
      id: result.lastInsertRowid,
      content, prompt, mood_score: moodScore, mood_label: moodLabel, tags,
      created_at: new Date().toISOString(),
    };
  }

  // Get a random writing prompt
  getPrompt() {
    // Try to avoid recently used prompts
    const recent = this.db.prepare(`
      SELECT prompt FROM journal
      WHERE prompt IS NOT NULL
      ORDER BY created_at DESC LIMIT 10
    `).all().map(r => r.prompt);

    const unused = JOURNAL_PROMPTS.filter(p => !recent.includes(p));
    const pool = unused.length ? unused : JOURNAL_PROMPTS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Get entries for a date range
  getEntries(days = 7) {
    return this.db.prepare(`
      SELECT * FROM journal
      WHERE created_at >= datetime('now','localtime','-${days} days')
      ORDER BY created_at DESC
    `).all();
  }

  // Get today's entries
  getToday() {
    return this.db.prepare(`
      SELECT * FROM journal
      WHERE date(created_at) = date('now','localtime')
      ORDER BY created_at DESC
    `).all();
  }

  // Get single entry
  getEntry(id) {
    return this.db.prepare('SELECT * FROM journal WHERE id = ?').get(id);
  }

  // Edit an entry
  edit(id, content) {
    const tags = this._autoTag(content).join(',');
    this.db.prepare('UPDATE journal SET content = ?, tags = ? WHERE id = ?').run(content, tags, id);
    return this.getEntry(id);
  }

  // Delete entry
  delete(id) {
    this.db.prepare('DELETE FROM journal WHERE id = ?').run(id);
    return { deleted: true, id };
  }

  // Pin/unpin
  togglePin(id) {
    const entry = this.getEntry(id);
    if (!entry) return null;
    const newVal = entry.pinned ? 0 : 1;
    this.db.prepare('UPDATE journal SET pinned = ? WHERE id = ?').run(newVal, id);
    return { id, pinned: !!newVal };
  }

  // Get pinned entries
  getPinned() {
    return this.db.prepare('SELECT * FROM journal WHERE pinned = 1 ORDER BY created_at DESC').all();
  }

  // Search entries
  search(query) {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (!keywords.length) return [];
    const conditions = keywords.map(() => 'LOWER(content) LIKE ?').join(' OR ');
    const params = keywords.map(k => `%${k}%`);
    return this.db.prepare(`
      SELECT * FROM journal WHERE ${conditions}
      ORDER BY created_at DESC LIMIT 20
    `).all(...params);
  }

  // Streak calculation
  getStreak() {
    const days = this.db.prepare(`
      SELECT DISTINCT date(created_at) as day FROM journal
      ORDER BY day DESC LIMIT 365
    `).all().map(r => r.day);

    if (!days.length) return { current: 0, longest: 0, total_entries: 0, total_days: 0 };

    const today = new Date().toISOString().slice(0, 10);
    let current = 0;
    let longest = 0;
    let streak = 0;
    let prevDate = null;

    for (const day of days) {
      if (!prevDate) {
        // First entry — check if it's today or yesterday
        if (day === today || day === this._yesterday()) {
          streak = 1;
        } else {
          break; // Current streak is 0
        }
      } else {
        const diff = this._dayDiff(day, prevDate);
        if (diff === 1) {
          streak++;
        } else {
          break;
        }
      }
      prevDate = day;
    }
    current = streak;

    // Calculate longest streak
    streak = 1;
    for (let i = 1; i < days.length; i++) {
      if (this._dayDiff(days[i], days[i - 1]) === 1) {
        streak++;
      } else {
        longest = Math.max(longest, streak);
        streak = 1;
      }
    }
    longest = Math.max(longest, streak, current);

    const totalEntries = this.db.prepare('SELECT COUNT(*) as c FROM journal').get().c;

    return { current, longest, total_entries: totalEntries, total_days: days.length };
  }

  // Weekly reflection data
  getWeeklyReflection() {
    const entries = this.getEntries(7);
    if (!entries.length) return null;

    const moodScores = entries.filter(e => e.mood_score != null).map(e => e.mood_score);
    const avgMood = moodScores.length ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length : null;

    // Tag frequency
    const tagCounts = {};
    for (const e of entries) {
      if (e.tags) {
        for (const t of e.tags.split(',')) {
          const tag = t.trim();
          if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Word count
    const totalWords = entries.reduce((sum, e) => sum + e.content.split(/\s+/).length, 0);

    return {
      entries: entries.length,
      avg_mood: avgMood ? +avgMood.toFixed(2) : null,
      top_tags: topTags,
      total_words: totalWords,
      pinned: entries.filter(e => e.pinned).length,
    };
  }

  _autoTag(content) {
    const lower = content.toLowerCase();
    const tags = [];
    const rules = {
      'work':     /work|job|meeting|deadline|project|client|boss|team|sprint|office/,
      'code':     /code|bug|deploy|git|api|server|function|programming|debug/,
      'health':   /health|workout|exercise|sleep|tired|sick|run|gym|diet|meditation/,
      'money':    /money|pay|bill|budget|invest|save|spend|income|expense|stock/,
      'social':   /friend|family|date|party|dinner|hangout|call|text|relationship/,
      'learning': /learn|read|study|course|tutorial|book|skill|practice/,
      'creative': /write|draw|design|music|art|build|create|idea|brainstorm/,
      'mood':     /happy|sad|anxious|stressed|grateful|frustrated|excited|calm|angry/,
      'goal':     /goal|plan|want|hope|dream|resolution|habit|milestone/,
      'travel':   /travel|trip|flight|hotel|vacation|explore|visit/,
    };
    for (const [tag, pattern] of Object.entries(rules)) {
      if (pattern.test(lower)) tags.push(tag);
    }
    return tags.length ? tags : ['general'];
  }

  _yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  _dayDiff(older, newer) {
    return Math.round((new Date(newer) - new Date(older)) / 86400000);
  }
}

export function formatJournalEntry(entry) {
  const date = new Date(entry.created_at).toLocaleString();
  const pin = entry.pinned ? ' 📌' : '';
  const tags = entry.tags ? ` [${entry.tags}]` : '';
  const mood = entry.mood_label ? ` — ${entry.mood_label}` : '';
  let text = `**#${entry.id}**${pin} — ${date}${mood}${tags}\n`;
  if (entry.prompt) text += `_Prompt: ${entry.prompt}_\n`;
  text += entry.content;
  return text;
}

export function formatJournalList(entries) {
  if (!entries.length) return '📓 No journal entries yet. Try `/journal write` to start.';
  let text = `📓 **Journal** (${entries.length} entries)\n\n`;
  for (const e of entries.slice(0, 10)) {
    const date = new Date(e.created_at).toLocaleDateString();
    const pin = e.pinned ? '📌 ' : '';
    const preview = e.content.substring(0, 80).replace(/\n/g, ' ');
    const mood = e.mood_label ? ` ${e.mood_label}` : '';
    text += `${pin}**#${e.id}** ${date}${mood} — ${preview}${e.content.length > 80 ? '...' : ''}\n`;
  }
  if (entries.length > 10) text += `\n_...and ${entries.length - 10} more_`;
  return text;
}

export function formatStreak(streak) {
  const fire = streak.current > 0 ? '🔥'.repeat(Math.min(streak.current, 7)) : '❄️';
  let text = `**📓 Journal Streak**\n\n`;
  text += `${fire} Current: **${streak.current} day${streak.current !== 1 ? 's' : ''}**\n`;
  text += `🏆 Longest: **${streak.longest} day${streak.longest !== 1 ? 's' : ''}**\n`;
  text += `📝 Total entries: **${streak.total_entries}**\n`;
  text += `📅 Days journaled: **${streak.total_days}**`;
  return text;
}

export function formatWeeklyReflection(ref) {
  if (!ref) return '📊 No entries this week to reflect on.';
  let text = `**📊 Weekly Reflection**\n\n`;
  text += `📝 Entries: **${ref.entries}** | Words: **${ref.total_words}** | Pinned: **${ref.pinned}**\n`;
  if (ref.avg_mood != null) {
    const emoji = ref.avg_mood >= 0.3 ? '😊' : ref.avg_mood >= -0.1 ? '😐' : '😔';
    text += `${emoji} Avg mood: **${ref.avg_mood}**\n`;
  }
  if (ref.top_tags.length) {
    text += `🏷️ Top themes: ${ref.top_tags.map(([t, c]) => `**${t}** (${c})`).join(', ')}\n`;
  }
  return text;
}

export { JOURNAL_PROMPTS };
