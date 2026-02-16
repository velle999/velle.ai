// ═══════════════════════════════════════════════════════════════
//  VELLE.AI — Productivity & Intelligence Module
//  • Todo/Task Manager
//  • Habit Tracker
//  • Pomodoro Timer
//  • Goal System
//  • Conversation Bookmarks
//  • Knowledge Base (snippets, links, notes)
//  • Achievement System
//  • Auto-Insights Engine
//  • Daily Briefing Generator
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════
//  1. TODO / TASK MANAGER
// ═══════════════════════════════════

export class TodoManager {
  constructor(db) {
    this.db = db;
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        project TEXT DEFAULT 'inbox',
        priority INTEGER DEFAULT 2 CHECK(priority BETWEEN 1 AND 4),
        status TEXT DEFAULT 'todo' CHECK(status IN ('todo','doing','done','cancelled')),
        due_date TEXT,
        tags TEXT,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        completed_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_todo_status ON todos(status);
      CREATE INDEX IF NOT EXISTS idx_todo_project ON todos(project);
      CREATE INDEX IF NOT EXISTS idx_todo_priority ON todos(priority);
    `);
  }

  add(content, project = 'inbox', priority = 2, dueDate = null, tags = null) {
    const stmt = this.db.prepare(
      'INSERT INTO todos (content, project, priority, due_date, tags) VALUES (?,?,?,?,?)'
    );
    const r = stmt.run(content, project, priority, dueDate, tags);
    return this.get(r.lastInsertRowid);
  }

  get(id) { return this.db.prepare('SELECT * FROM todos WHERE id = ?').get(id); }

  getAll(status = null) {
    if (status) return this.db.prepare('SELECT * FROM todos WHERE status = ? ORDER BY priority ASC, created_at DESC').all(status);
    return this.db.prepare("SELECT * FROM todos WHERE status != 'cancelled' ORDER BY status ASC, priority ASC, created_at DESC").all();
  }

  getByProject(project) {
    return this.db.prepare("SELECT * FROM todos WHERE project = ? AND status != 'cancelled' ORDER BY priority ASC").all(project);
  }

  getOverdue() {
    return this.db.prepare("SELECT * FROM todos WHERE status = 'todo' AND due_date < date('now','localtime') ORDER BY due_date ASC").all();
  }

  getToday() {
    return this.db.prepare("SELECT * FROM todos WHERE status IN ('todo','doing') AND (due_date = date('now','localtime') OR due_date IS NULL) ORDER BY priority ASC").all();
  }

  complete(id) {
    this.db.prepare("UPDATE todos SET status = 'done', completed_at = datetime('now','localtime') WHERE id = ?").run(id);
    return this.get(id);
  }

  start(id) {
    this.db.prepare("UPDATE todos SET status = 'doing' WHERE id = ?").run(id);
    return this.get(id);
  }

  cancel(id) {
    this.db.prepare("UPDATE todos SET status = 'cancelled' WHERE id = ?").run(id);
    return { id, cancelled: true };
  }

  edit(id, updates) {
    const fields = [];
    const vals = [];
    for (const [k, v] of Object.entries(updates)) {
      if (['content','project','priority','due_date','tags','status'].includes(k)) {
        fields.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (!fields.length) return this.get(id);
    vals.push(id);
    this.db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.get(id);
  }

  delete(id) {
    this.db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    return { deleted: true, id };
  }

  getProjects() {
    return this.db.prepare("SELECT project, COUNT(*) as count, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done FROM todos GROUP BY project ORDER BY count DESC").all();
  }

  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as c FROM todos').get().c;
    const done = this.db.prepare("SELECT COUNT(*) as c FROM todos WHERE status='done'").get().c;
    const active = this.db.prepare("SELECT COUNT(*) as c FROM todos WHERE status IN ('todo','doing')").get().c;
    const overdue = this.getOverdue().length;
    const todayDone = this.db.prepare("SELECT COUNT(*) as c FROM todos WHERE status='done' AND date(completed_at)=date('now','localtime')").get().c;
    return { total, done, active, overdue, today_done: todayDone, completion_rate: total ? +(done / total * 100).toFixed(1) : 0 };
  }
}

const PRIO_ICONS = { 1: '🔴', 2: '🟡', 3: '🟢', 4: '⚪' };
const STATUS_ICONS = { todo: '☐', doing: '🔄', done: '✅', cancelled: '❌' };

export function formatTodo(t) {
  const prio = PRIO_ICONS[t.priority] || '⚪';
  const stat = STATUS_ICONS[t.status] || '☐';
  const due = t.due_date ? ` 📅 ${t.due_date}` : '';
  const proj = t.project !== 'inbox' ? ` [${t.project}]` : '';
  const tags = t.tags ? ` ${t.tags.split(',').map(t=>'#'+t.trim()).join(' ')}` : '';
  return `${stat} ${prio} **#${t.id}** ${t.content}${due}${proj}${tags}`;
}

export function formatTodoList(todos, title = 'Tasks') {
  if (!todos.length) return `📋 No ${title.toLowerCase()} found.`;
  let txt = `📋 **${title}** (${todos.length})\n\n`;
  for (const t of todos.slice(0, 20)) txt += formatTodo(t) + '\n';
  if (todos.length > 20) txt += `\n_...and ${todos.length - 20} more_`;
  return txt;
}


// ═══════════════════════════════════
//  2. HABIT TRACKER
// ═══════════════════════════════════

export class HabitTracker {
  constructor(db) {
    this.db = db;
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '✅',
        frequency TEXT DEFAULT 'daily',
        target INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS habit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER NOT NULL,
        value INTEGER DEFAULT 1,
        date TEXT DEFAULT (date('now','localtime')),
        FOREIGN KEY (habit_id) REFERENCES habits(id),
        UNIQUE(habit_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_hlog_date ON habit_logs(date);
      CREATE INDEX IF NOT EXISTS idx_hlog_habit ON habit_logs(habit_id);
    `);
  }

  addHabit(name, icon = '✅', frequency = 'daily', target = 1) {
    const r = this.db.prepare('INSERT INTO habits (name, icon, frequency, target) VALUES (?,?,?,?)').run(name, icon, frequency, target);
    return this.getHabit(r.lastInsertRowid);
  }

  getHabit(id) { return this.db.prepare('SELECT * FROM habits WHERE id = ?').get(id); }

  getAllHabits() { return this.db.prepare('SELECT * FROM habits ORDER BY created_at ASC').all(); }

  deleteHabit(id) {
    this.db.prepare('DELETE FROM habit_logs WHERE habit_id = ?').run(id);
    this.db.prepare('DELETE FROM habits WHERE id = ?').run(id);
    return { deleted: true, id };
  }

  checkIn(habitId, date = null) {
    const d = date || new Date().toISOString().slice(0, 10);
    try {
      this.db.prepare('INSERT OR REPLACE INTO habit_logs (habit_id, value, date) VALUES (?,1,?)').run(habitId, d);
      return { habit_id: habitId, date: d, checked: true };
    } catch { return { habit_id: habitId, date: d, checked: false, error: 'already checked' }; }
  }

  uncheck(habitId, date = null) {
    const d = date || new Date().toISOString().slice(0, 10);
    this.db.prepare('DELETE FROM habit_logs WHERE habit_id = ? AND date = ?').run(habitId, d);
    return { habit_id: habitId, date: d, unchecked: true };
  }

  getTodayStatus() {
    const today = new Date().toISOString().slice(0, 10);
    const habits = this.getAllHabits();
    return habits.map(h => {
      const log = this.db.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?').get(h.id, today);
      return { ...h, completed_today: !!log };
    });
  }

  getStreak(habitId) {
    const days = this.db.prepare('SELECT date FROM habit_logs WHERE habit_id = ? ORDER BY date DESC').all(habitId).map(r => r.date);
    if (!days.length) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (days[0] !== today && days[0] !== yesterday) return 0;
    let streak = 1;
    for (let i = 1; i < days.length; i++) {
      const diff = Math.round((new Date(days[i - 1]) - new Date(days[i])) / 86400000);
      if (diff === 1) streak++;
      else break;
    }
    return streak;
  }

  getWeekGrid(habitId) {
    const grid = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const log = this.db.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?').get(habitId, d);
      grid.push({ date: d, done: !!log });
    }
    return grid;
  }

  getCompletionRate(habitId, days = 30) {
    const total = this.db.prepare(`SELECT COUNT(DISTINCT date) as c FROM habit_logs WHERE habit_id = ? AND date >= date('now','localtime','-${days} days')`).get(habitId).c;
    return +(total / Math.min(days, 30) * 100).toFixed(1);
  }

  getDashboard() {
    const habits = this.getAllHabits();
    return habits.map(h => ({
      ...h,
      streak: this.getStreak(h.id),
      week: this.getWeekGrid(h.id),
      rate_30d: this.getCompletionRate(h.id, 30),
      completed_today: this.getTodayStatus().find(s => s.id === h.id)?.completed_today || false,
    }));
  }
}

export function formatHabitDashboard(habits) {
  if (!habits.length) return '🔄 No habits tracked yet. Try `/habit add Exercise` to start.';
  let txt = '🔄 **Habit Tracker**\n\n';
  for (const h of habits) {
    const weekViz = h.week.map(d => d.done ? '🟩' : '⬜').join('');
    const fire = h.streak > 0 ? `🔥${h.streak}` : '';
    const check = h.completed_today ? '✅' : '☐';
    txt += `${check} ${h.icon} **${h.name}** ${weekViz} ${fire} (${h.rate_30d}% / 30d)\n`;
  }
  txt += '\nCheck in: `/habit check ID` | Add: `/habit add name`';
  return txt;
}


// ═══════════════════════════════════
//  3. POMODORO TIMER
// ═══════════════════════════════════

export class PomodoroEngine {
  constructor(db) {
    this.db = db;
    this.active = new Map(); // sessionId -> timer state
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pomodoro_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT,
        duration INTEGER DEFAULT 25,
        type TEXT DEFAULT 'focus' CHECK(type IN ('focus','short_break','long_break')),
        completed INTEGER DEFAULT 0,
        started_at DATETIME DEFAULT (datetime('now','localtime')),
        ended_at DATETIME
      );
    `);
  }

  start(wsId, task = null, duration = 25) {
    const stmt = this.db.prepare('INSERT INTO pomodoro_sessions (task, duration) VALUES (?,?)');
    const r = stmt.run(task, duration);
    this.active.set(wsId, {
      id: r.lastInsertRowid,
      task,
      duration,
      started: Date.now(),
      type: 'focus',
    });
    return { id: r.lastInsertRowid, task, duration, type: 'focus', started: true };
  }

  stop(wsId) {
    const session = this.active.get(wsId);
    if (!session) return null;
    const elapsed = Math.round((Date.now() - session.started) / 60000);
    this.db.prepare("UPDATE pomodoro_sessions SET completed = 1, ended_at = datetime('now','localtime') WHERE id = ?").run(session.id);
    this.active.delete(wsId);
    return { id: session.id, task: session.task, elapsed_minutes: elapsed, completed: true };
  }

  getStatus(wsId) {
    const session = this.active.get(wsId);
    if (!session) return null;
    const elapsed = Math.round((Date.now() - session.started) / 1000);
    const remaining = Math.max(0, session.duration * 60 - elapsed);
    return {
      id: session.id,
      task: session.task,
      duration: session.duration,
      elapsed_seconds: elapsed,
      remaining_seconds: remaining,
      remaining_display: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`,
      type: session.type,
      done: remaining === 0,
    };
  }

  getTodayStats() {
    const sessions = this.db.prepare("SELECT * FROM pomodoro_sessions WHERE date(started_at) = date('now','localtime') AND completed = 1").all();
    const totalMin = sessions.reduce((s, p) => s + p.duration, 0);
    return { sessions: sessions.length, total_minutes: totalMin, total_display: `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` };
  }

  getWeekStats() {
    const sessions = this.db.prepare("SELECT * FROM pomodoro_sessions WHERE started_at >= datetime('now','localtime','-7 days') AND completed = 1").all();
    const totalMin = sessions.reduce((s, p) => s + p.duration, 0);
    const byDay = {};
    for (const s of sessions) {
      const day = s.started_at.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + s.duration;
    }
    return { sessions: sessions.length, total_minutes: totalMin, by_day: byDay };
  }
}


// ═══════════════════════════════════
//  4. GOAL SYSTEM
// ═══════════════════════════════════

export class GoalTracker {
  constructor(db) {
    this.db = db;
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        target_date TEXT,
        progress INTEGER DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
        status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
        category TEXT DEFAULT 'general',
        created_at DATETIME DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        FOREIGN KEY (goal_id) REFERENCES goals(id)
      );
    `);
  }

  addGoal(title, description = null, targetDate = null, category = 'general') {
    const r = this.db.prepare('INSERT INTO goals (title, description, target_date, category) VALUES (?,?,?,?)').run(title, description, targetDate, category);
    return this.getGoal(r.lastInsertRowid);
  }

  getGoal(id) {
    const goal = this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
    if (goal) goal.milestones = this.db.prepare('SELECT * FROM milestones WHERE goal_id = ? ORDER BY id ASC').all(id);
    return goal;
  }

  getAll(status = 'active') {
    const goals = this.db.prepare('SELECT * FROM goals WHERE status = ? ORDER BY created_at DESC').all(status);
    for (const g of goals) {
      g.milestones = this.db.prepare('SELECT * FROM milestones WHERE goal_id = ?').all(g.id);
    }
    return goals;
  }

  updateProgress(id, progress) {
    this.db.prepare('UPDATE goals SET progress = ?, status = CASE WHEN ? >= 100 THEN \'completed\' ELSE status END WHERE id = ?').run(progress, progress, id);
    return this.getGoal(id);
  }

  addMilestone(goalId, title) {
    const r = this.db.prepare('INSERT INTO milestones (goal_id, title) VALUES (?,?)').run(goalId, title);
    this._recalcProgress(goalId);
    return this.getGoal(goalId);
  }

  completeMilestone(milestoneId) {
    const ms = this.db.prepare('SELECT * FROM milestones WHERE id = ?').get(milestoneId);
    if (!ms) return null;
    this.db.prepare("UPDATE milestones SET completed = 1, completed_at = datetime('now','localtime') WHERE id = ?").run(milestoneId);
    this._recalcProgress(ms.goal_id);
    return this.getGoal(ms.goal_id);
  }

  _recalcProgress(goalId) {
    const all = this.db.prepare('SELECT COUNT(*) as c FROM milestones WHERE goal_id = ?').get(goalId).c;
    const done = this.db.prepare('SELECT COUNT(*) as c FROM milestones WHERE goal_id = ? AND completed = 1').get(goalId).c;
    if (all > 0) {
      const pct = Math.round(done / all * 100);
      this.db.prepare('UPDATE goals SET progress = ?, status = CASE WHEN ? >= 100 THEN \'completed\' ELSE status END WHERE id = ?').run(pct, pct, goalId);
    }
  }

  deleteGoal(id) {
    this.db.prepare('DELETE FROM milestones WHERE goal_id = ?').run(id);
    this.db.prepare('DELETE FROM goals WHERE id = ?').run(id);
    return { deleted: true, id };
  }
}

export function formatGoal(g) {
  const bar = progressBar(g.progress);
  const date = g.target_date ? ` 📅 ${g.target_date}` : '';
  let txt = `🎯 **#${g.id} ${g.title}** ${bar} ${g.progress}%${date}\n`;
  if (g.description) txt += `   _${g.description}_\n`;
  if (g.milestones?.length) {
    for (const m of g.milestones) {
      txt += `   ${m.completed ? '✅' : '☐'} ${m.title}\n`;
    }
  }
  return txt;
}

export function formatGoalList(goals) {
  if (!goals.length) return '🎯 No active goals. Set one with `/goal add title`.';
  let txt = '🎯 **Goals**\n\n';
  for (const g of goals) txt += formatGoal(g) + '\n';
  return txt;
}

function progressBar(pct, len = 10) {
  const filled = Math.round(pct / 100 * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}


// ═══════════════════════════════════
//  5. CONVERSATION BOOKMARKS
// ═══════════════════════════════════

export class BookmarkManager {
  constructor(db) {
    this.db = db;
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        note TEXT,
        tags TEXT,
        session_id TEXT,
        source TEXT DEFAULT 'chat',
        created_at DATETIME DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_bm_tags ON bookmarks(tags);
    `);
  }

  save(content, note = null, tags = null, sessionId = null, source = 'chat') {
    const r = this.db.prepare('INSERT INTO bookmarks (content, note, tags, session_id, source) VALUES (?,?,?,?,?)').run(content, note, tags, sessionId, source);
    return this.get(r.lastInsertRowid);
  }

  get(id) { return this.db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id); }

  getAll(limit = 20) {
    return this.db.prepare('SELECT * FROM bookmarks ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  search(query) {
    const kw = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    if (!kw.length) return [];
    const conds = kw.map(() => '(LOWER(content) LIKE ? OR LOWER(note) LIKE ? OR LOWER(tags) LIKE ?)').join(' OR ');
    const params = kw.flatMap(k => [`%${k}%`, `%${k}%`, `%${k}%`]);
    return this.db.prepare(`SELECT * FROM bookmarks WHERE ${conds} ORDER BY created_at DESC LIMIT 20`).all(...params);
  }

  getByTag(tag) {
    return this.db.prepare("SELECT * FROM bookmarks WHERE tags LIKE ? ORDER BY created_at DESC").all(`%${tag}%`);
  }

  delete(id) {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
    return { deleted: true, id };
  }
}

export function formatBookmarkList(bms) {
  if (!bms.length) return '🔖 No bookmarks yet. Save one with `/bookmark save content`.';
  let txt = '🔖 **Bookmarks**\n\n';
  for (const b of bms.slice(0, 15)) {
    const tags = b.tags ? ` [${b.tags}]` : '';
    const note = b.note ? ` — _${b.note}_` : '';
    const preview = b.content.substring(0, 100).replace(/\n/g, ' ');
    txt += `**#${b.id}**${tags} ${preview}${b.content.length > 100 ? '...' : ''}${note}\n`;
  }
  return txt;
}


// ═══════════════════════════════════
//  6. KNOWLEDGE BASE
// ═══════════════════════════════════

export class KnowledgeBase {
  constructor(db) {
    this.db = db;
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'note' CHECK(type IN ('note','snippet','link','reference')),
        language TEXT,
        tags TEXT,
        pinned INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        updated_at DATETIME DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_kb_type ON knowledge(type);
      CREATE INDEX IF NOT EXISTS idx_kb_tags ON knowledge(tags);
    `);
  }

  add(title, content, type = 'note', language = null, tags = null) {
    const r = this.db.prepare('INSERT INTO knowledge (title, content, type, language, tags) VALUES (?,?,?,?,?)').run(title, content, type, language, tags);
    return this.get(r.lastInsertRowid);
  }

  get(id) { return this.db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id); }

  getAll(type = null, limit = 20) {
    if (type) return this.db.prepare('SELECT * FROM knowledge WHERE type = ? ORDER BY updated_at DESC LIMIT ?').all(type, limit);
    return this.db.prepare('SELECT * FROM knowledge ORDER BY pinned DESC, updated_at DESC LIMIT ?').all(limit);
  }

  search(query) {
    const kw = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    if (!kw.length) return [];
    const conds = kw.map(() => '(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)').join(' OR ');
    const params = kw.flatMap(k => [`%${k}%`, `%${k}%`, `%${k}%`]);
    return this.db.prepare(`SELECT * FROM knowledge WHERE ${conds} ORDER BY updated_at DESC LIMIT 20`).all(...params);
  }

  update(id, content) {
    this.db.prepare("UPDATE knowledge SET content = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(content, id);
    return this.get(id);
  }

  togglePin(id) {
    const entry = this.get(id);
    if (!entry) return null;
    this.db.prepare('UPDATE knowledge SET pinned = ? WHERE id = ?').run(entry.pinned ? 0 : 1, id);
    return this.get(id);
  }

  delete(id) {
    this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
    return { deleted: true, id };
  }

  getStats() {
    return {
      total: this.db.prepare('SELECT COUNT(*) as c FROM knowledge').get().c,
      notes: this.db.prepare("SELECT COUNT(*) as c FROM knowledge WHERE type='note'").get().c,
      snippets: this.db.prepare("SELECT COUNT(*) as c FROM knowledge WHERE type='snippet'").get().c,
      links: this.db.prepare("SELECT COUNT(*) as c FROM knowledge WHERE type='link'").get().c,
    };
  }
}

const TYPE_ICONS = { note: '📝', snippet: '💻', link: '🔗', reference: '📚' };

export function formatKBList(items) {
  if (!items.length) return '📚 Knowledge base is empty. Add with `/kb add title | content`.';
  let txt = '📚 **Knowledge Base**\n\n';
  for (const item of items.slice(0, 15)) {
    const icon = TYPE_ICONS[item.type] || '📝';
    const pin = item.pinned ? '📌 ' : '';
    const tags = item.tags ? ` [${item.tags}]` : '';
    const preview = item.content.substring(0, 80).replace(/\n/g, ' ');
    txt += `${pin}${icon} **#${item.id} ${item.title}**${tags}\n   ${preview}${item.content.length > 80 ? '...' : ''}\n`;
  }
  return txt;
}


// ═══════════════════════════════════
//  7. ACHIEVEMENT SYSTEM
// ═══════════════════════════════════

const ACHIEVEMENTS = [
  { id: 'first_msg',      name: 'First Contact',       icon: '🌟', desc: 'Send your first message',               check: s => s.messages >= 1 },
  { id: 'chatterbox',     name: 'Chatterbox',          icon: '💬', desc: 'Send 100 messages',                     check: s => s.messages >= 100 },
  { id: 'veteran',        name: 'Veteran',             icon: '🎖️', desc: 'Send 1000 messages',                    check: s => s.messages >= 1000 },
  { id: 'memory_1',       name: 'Elephant',            icon: '🐘', desc: 'Save your first memory',                check: s => s.memories >= 1 },
  { id: 'memory_10',      name: 'Librarian',           icon: '📚', desc: 'Save 10 memories',                      check: s => s.memories >= 10 },
  { id: 'memory_50',      name: 'Archive Master',      icon: '🏛️', desc: 'Save 50 memories',                      check: s => s.memories >= 50 },
  { id: 'journal_1',      name: 'Dear Diary',          icon: '📓', desc: 'Write first journal entry',             check: s => s.journal_entries >= 1 },
  { id: 'journal_7',      name: 'Week Writer',         icon: '✍️', desc: 'Write 7 journal entries',               check: s => s.journal_entries >= 7 },
  { id: 'journal_30',     name: 'Chronicler',          icon: '📜', desc: '30 journal entries',                    check: s => s.journal_entries >= 30 },
  { id: 'streak_3',       name: 'On a Roll',           icon: '🔥', desc: '3-day journal streak',                  check: s => s.journal_streak >= 3 },
  { id: 'streak_7',       name: 'Week Warrior',        icon: '⚡', desc: '7-day journal streak',                  check: s => s.journal_streak >= 7 },
  { id: 'streak_30',      name: 'Iron Will',           icon: '💎', desc: '30-day journal streak',                 check: s => s.journal_streak >= 30 },
  { id: 'todo_1',         name: 'Getting Things Done',  icon: '✅', desc: 'Complete first task',                   check: s => s.todos_done >= 1 },
  { id: 'todo_25',        name: 'Task Master',          icon: '🏆', desc: 'Complete 25 tasks',                    check: s => s.todos_done >= 25 },
  { id: 'todo_100',       name: 'Productivity Machine', icon: '⚙️', desc: 'Complete 100 tasks',                   check: s => s.todos_done >= 100 },
  { id: 'habit_1',        name: 'Habit Former',         icon: '🔄', desc: 'Create your first habit',              check: s => s.habits >= 1 },
  { id: 'habit_streak_7', name: 'Consistent',           icon: '📈', desc: '7-day habit streak',                   check: s => s.max_habit_streak >= 7 },
  { id: 'pomodoro_1',     name: 'Focused',              icon: '🍅', desc: 'Complete first pomodoro',              check: s => s.pomodoros >= 1 },
  { id: 'pomodoro_25',    name: 'Deep Worker',          icon: '🧠', desc: 'Complete 25 pomodoros',                check: s => s.pomodoros >= 25 },
  { id: 'goal_1',         name: 'Visionary',            icon: '🎯', desc: 'Set your first goal',                  check: s => s.goals >= 1 },
  { id: 'goal_done',      name: 'Goal Crusher',         icon: '🏅', desc: 'Complete a goal',                      check: s => s.goals_done >= 1 },
  { id: 'kb_10',          name: 'Knowledge Hoarder',    icon: '🧩', desc: 'Save 10 knowledge items',              check: s => s.kb_items >= 10 },
  { id: 'bookmark_5',     name: 'Curator',              icon: '🔖', desc: 'Save 5 bookmarks',                     check: s => s.bookmarks >= 5 },
  { id: 'night_owl',      name: 'Night Owl',            icon: '🦉', desc: 'Send a message after midnight',        check: s => s.night_messages >= 1 },
  { id: 'early_bird',     name: 'Early Bird',           icon: '🐦', desc: 'Send a message before 6am',            check: s => s.early_messages >= 1 },
];

export class AchievementEngine {
  constructor(db) {
    this.db = db;
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS achievements (
        id TEXT PRIMARY KEY,
        unlocked_at DATETIME DEFAULT (datetime('now','localtime'))
      );
    `);
  }

  getUnlocked() {
    const rows = this.db.prepare('SELECT * FROM achievements ORDER BY unlocked_at ASC').all();
    const ids = new Set(rows.map(r => r.id));
    return ACHIEVEMENTS.filter(a => ids.has(a.id)).map(a => ({
      ...a,
      unlocked_at: rows.find(r => r.id === a.id).unlocked_at,
    }));
  }

  checkAndUnlock(stats) {
    const unlocked = new Set(this.db.prepare('SELECT id FROM achievements').all().map(r => r.id));
    const newlyUnlocked = [];

    for (const ach of ACHIEVEMENTS) {
      if (unlocked.has(ach.id)) continue;
      try {
        if (ach.check(stats)) {
          this.db.prepare('INSERT OR IGNORE INTO achievements (id) VALUES (?)').run(ach.id);
          newlyUnlocked.push(ach);
        }
      } catch {}
    }
    return newlyUnlocked;
  }

  getAll() {
    const unlocked = new Set(this.db.prepare('SELECT id FROM achievements').all().map(r => r.id));
    return ACHIEVEMENTS.map(a => ({ ...a, unlocked: unlocked.has(a.id) }));
  }

  getProgress() {
    const total = ACHIEVEMENTS.length;
    const unlocked = this.db.prepare('SELECT COUNT(*) as c FROM achievements').get().c;
    return { unlocked, total, percent: +(unlocked / total * 100).toFixed(1) };
  }
}

export function formatAchievements(all) {
  let txt = '🏆 **Achievements**\n\n';
  const unlocked = all.filter(a => a.unlocked);
  const locked = all.filter(a => !a.unlocked);
  if (unlocked.length) {
    txt += '**Unlocked:**\n';
    for (const a of unlocked) txt += `${a.icon} **${a.name}** — _${a.desc}_\n`;
  }
  if (locked.length) {
    txt += `\n**Locked (${locked.length}):**\n`;
    for (const a of locked) txt += `🔒 ${a.name} — _${a.desc}_\n`;
  }
  txt += `\n**Progress:** ${unlocked.length}/${all.length} (${(unlocked.length / all.length * 100).toFixed(0)}%)`;
  return txt;
}


// ═══════════════════════════════════
//  8. AUTO-INSIGHTS ENGINE
// ═══════════════════════════════════

export class InsightEngine {
  constructor(db) {
    this.db = db;
  }

  generate() {
    const insights = [];

    // Mood insights
    try {
      const moodData = this.db.prepare(`
        SELECT date(timestamp) as day, AVG(score) as avg
        FROM mood_log WHERE timestamp >= datetime('now','localtime','-7 days')
        GROUP BY day ORDER BY day ASC
      `).all();

      if (moodData.length >= 3) {
        const recent = moodData.slice(-3).reduce((s, d) => s + d.avg, 0) / 3;
        const older = moodData.slice(0, -3);
        const olderAvg = older.length ? older.reduce((s, d) => s + d.avg, 0) / older.length : 0;

        if (recent < -0.2 && recent < olderAvg - 0.15) {
          insights.push({ type: 'mood', icon: '📉', text: "Your mood has been trending down the last few days. Take it easy on yourself." });
        } else if (recent > 0.3 && recent > olderAvg + 0.15) {
          insights.push({ type: 'mood', icon: '📈', text: "You've been in great spirits lately! Keep up whatever you're doing." });
        }
      }

      // Mood trigger analysis
      const triggers = this.db.prepare(`
        SELECT triggers FROM mood_log
        WHERE timestamp >= datetime('now','localtime','-7 days') AND triggers != '' AND score < -0.1
      `).all();
      const triggerCounts = {};
      for (const t of triggers) {
        for (const tag of t.triggers.split(',')) {
          const clean = tag.trim();
          if (clean) triggerCounts[clean] = (triggerCounts[clean] || 0) + 1;
        }
      }
      const topStressor = Object.entries(triggerCounts).sort((a, b) => b[1] - a[1])[0];
      if (topStressor && topStressor[1] >= 3) {
        insights.push({ type: 'mood', icon: '⚠️', text: `"${topStressor[0]}" has been a recurring source of stress (${topStressor[1]}x this week).` });
      }
    } catch {}

    // Productivity insights
    try {
      const todoDone = this.db.prepare("SELECT COUNT(*) as c FROM todos WHERE status='done' AND date(completed_at) >= date('now','localtime','-7 days')").get().c;
      const todoCreated = this.db.prepare("SELECT COUNT(*) as c FROM todos WHERE date(created_at) >= date('now','localtime','-7 days')").get().c;
      if (todoCreated > 0 && todoDone < todoCreated * 0.3) {
        insights.push({ type: 'productivity', icon: '📋', text: `You created ${todoCreated} tasks but only completed ${todoDone} this week. Consider prioritizing fewer items.` });
      } else if (todoDone >= 10) {
        insights.push({ type: 'productivity', icon: '🚀', text: `${todoDone} tasks completed this week — you're on fire!` });
      }
    } catch {}

    // Journal insights
    try {
      const jEntries = this.db.prepare("SELECT COUNT(*) as c FROM journal WHERE created_at >= datetime('now','localtime','-7 days')").get().c;
      if (jEntries === 0) {
        insights.push({ type: 'journal', icon: '📓', text: "You haven't journaled this week. Even a sentence counts — try `/journal prompt`." });
      }
    } catch {}

    // Habit insights
    try {
      const habits = this.db.prepare('SELECT * FROM habits').all();
      for (const h of habits) {
        const recent = this.db.prepare(`SELECT COUNT(*) as c FROM habit_logs WHERE habit_id = ? AND date >= date('now','localtime','-7 days')`).get(h.id).c;
        if (recent === 0 && habits.length > 0) {
          insights.push({ type: 'habit', icon: '🔄', text: `You haven't tracked "${h.name}" at all this week.` });
          break; // Only one habit nag
        }
      }
    } catch {}

    // Activity pattern
    try {
      const hourly = this.db.prepare(`
        SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as c
        FROM conversations WHERE timestamp >= datetime('now','localtime','-14 days') AND role = 'user'
        GROUP BY hour ORDER BY c DESC LIMIT 1
      `).get();
      if (hourly) {
        const h = hourly.hour;
        const period = h < 6 ? 'late night 🦉' : h < 12 ? 'morning 🌅' : h < 18 ? 'afternoon ☀️' : 'evening 🌙';
        insights.push({ type: 'pattern', icon: '⏰', text: `Your most active time is ${period} (around ${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}).` });
      }
    } catch {}

    // Overdue tasks
    try {
      const overdue = this.db.prepare("SELECT COUNT(*) as c FROM todos WHERE status = 'todo' AND due_date < date('now','localtime')").get().c;
      if (overdue > 0) {
        insights.push({ type: 'productivity', icon: '⏰', text: `You have ${overdue} overdue task${overdue > 1 ? 's' : ''}. Review with \`/todo overdue\`.` });
      }
    } catch {}

    return insights;
  }
}

export function formatInsights(insights) {
  if (!insights.length) return '💡 No insights yet — keep using VELLE.AI and patterns will emerge.';
  let txt = '💡 **Insights**\n\n';
  for (const i of insights) txt += `${i.icon} ${i.text}\n\n`;
  return txt;
}


// ═══════════════════════════════════
//  9. DAILY BRIEFING GENERATOR
// ═══════════════════════════════════

export class BriefingEngine {
  constructor(db) {
    this.db = db;
  }

  async generate(components = {}) {
    const now = new Date();
    const timeOfDay = now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening';
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    let briefing = `**☀️ Good ${timeOfDay}! — ${dayName}, ${dateStr}**\n\n`;

    // Mood
    if (components.mood) {
      briefing += `**Mood:** ${components.mood.label} (trend: ${components.mood.trend})\n\n`;
    }

    // Reminders
    if (components.reminders?.length) {
      briefing += `**⏰ Upcoming Reminders:**\n`;
      for (const r of components.reminders.slice(0, 5)) {
        briefing += `• ${r.content} — ${r.due_at}\n`;
      }
      briefing += '\n';
    }

    // Tasks
    if (components.todos) {
      const { active, overdue, today_done } = components.todos;
      briefing += `**📋 Tasks:** ${active} active`;
      if (overdue > 0) briefing += `, ⚠️ ${overdue} overdue`;
      if (today_done > 0) briefing += `, ${today_done} done today`;
      briefing += '\n\n';
    }

    // Habits
    if (components.habits?.length) {
      const done = components.habits.filter(h => h.completed_today).length;
      briefing += `**🔄 Habits:** ${done}/${components.habits.length} completed today\n`;
      for (const h of components.habits) {
        briefing += `${h.completed_today ? '✅' : '☐'} ${h.icon} ${h.name}`;
        if (h.streak > 0) briefing += ` 🔥${h.streak}`;
        briefing += '\n';
      }
      briefing += '\n';
    }

    // Goals
    if (components.goals?.length) {
      briefing += `**🎯 Goals:**\n`;
      for (const g of components.goals.slice(0, 3)) {
        briefing += `• ${g.title} ${progressBar(g.progress)} ${g.progress}%\n`;
      }
      briefing += '\n';
    }

    // Journal streak
    if (components.journalStreak) {
      const s = components.journalStreak;
      if (s.current > 0) {
        briefing += `**📓 Journal streak:** ${'🔥'.repeat(Math.min(s.current, 5))} ${s.current} days\n\n`;
      } else {
        briefing += `**📓 Journal:** No streak active — write one to start! \`/journal write\`\n\n`;
      }
    }

    // Pomodoro stats
    if (components.pomodoro) {
      const p = components.pomodoro;
      if (p.sessions > 0) {
        briefing += `**🍅 Focus time today:** ${p.total_display} (${p.sessions} sessions)\n\n`;
      }
    }

    // Achievements
    if (components.achievements) {
      briefing += `**🏆 Achievements:** ${components.achievements.unlocked}/${components.achievements.total}\n\n`;
    }

    // Insights
    if (components.insights?.length) {
      briefing += `**💡 Insights:**\n`;
      for (const i of components.insights.slice(0, 3)) {
        briefing += `${i.icon} ${i.text}\n`;
      }
      briefing += '\n';
    }

    // Market (optional)
    if (components.market) {
      briefing += `**📊 Markets:** ${components.market}\n\n`;
    }

    briefing += `_Type \`/help\` for all commands._`;

    return briefing;
  }
}
