import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MemoryManager } from './memory.js';
import { CommandExecutor } from './commands.js';
import {
  ReminderEngine, parseReminderTime, parseRepeat,
  MoodTracker,
  SummaryEngine,
  autoTagMemory, autoImportance,
  FileSearchEngine, formatFileResults,
  JournalEngine, formatJournalEntry, formatJournalList, formatStreak, formatWeeklyReflection,
} from './advanced.js';
import {
  TodoManager, formatTodo, formatTodoList,
  HabitTracker, formatHabitDashboard,
  PomodoroEngine,
  GoalTracker, formatGoal, formatGoalList,
  BookmarkManager, formatBookmarkList,
  KnowledgeBase, formatKBList,
  AchievementEngine, formatAchievements,
  InsightEngine, formatInsights,
  BriefingEngine,
} from './productivity.js';
import {
  getMarketSnapshot, formatMarketSnapshot,
  getQuote, formatQuote,
  analyzeStock, formatAnalysis,
  momentumScan, formatMomentum,
  dislocations, formatDislocations,
  backtestRSI, formatBacktest,
  getSentiment, formatSentiment,
  findMoonshots, formatMoonshots,
  getChartData,
  WATCHLIST,
} from './quant.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ──

const CONFIG = {
  port: parseInt(process.env.PORT || '3000'),
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  model: process.env.MODEL || 'llama3.2',
  dbPath: join(ROOT, 'memory', 'companion.db'),
};

// ── Initialize ──

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const memory = new MemoryManager(CONFIG.dbPath);
const commander = new CommandExecutor(memory);
const reminders = new ReminderEngine(memory.db);
const mood = new MoodTracker(memory.db);
const summaries = new SummaryEngine(memory.db, CONFIG.ollamaUrl, CONFIG.model);
const fileSearch = new FileSearchEngine();
const journal = new JournalEngine(memory.db);
const todos = new TodoManager(memory.db);
const habits = new HabitTracker(memory.db);
const pomodoro = new PomodoroEngine(memory.db);
const goals = new GoalTracker(memory.db);
const bookmarks = new BookmarkManager(memory.db);
const kb = new KnowledgeBase(memory.db);
const achievements = new AchievementEngine(memory.db);
const insightEngine = new InsightEngine(memory.db);
const briefing = new BriefingEngine(memory.db);

// Start reminder scheduler
reminders.startAll();
reminders.startPeriodicCheck();

const TYPE_ICONS = { note: '📝', snippet: '💻', link: '🔗', reference: '📚' };

// Load personality profiles
const profilesPath = join(ROOT, 'personalities', 'profiles.json');
const personalities = JSON.parse(readFileSync(profilesPath, 'utf-8'));

app.use(express.json());
app.use(express.static(join(ROOT, 'public')));

// ── REST API ──

// Get available personalities
app.get('/api/personalities', (req, res) => {
  const list = Object.entries(personalities).map(([key, p]) => ({
    id: key, name: p.name, icon: p.icon, greeting: p.greeting, style: p.style
  }));
  res.json(list);
});

// Get memories
app.get('/api/memories', (req, res) => {
  const category = req.query.category || null;
  res.json(memory.getMemories(category, 50));
});

// Save a memory
app.post('/api/memories', (req, res) => {
  const { content, category, importance } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  const result = memory.saveMemory(content, category || 'general', importance || 5, 'explicit');
  res.json(result);
});

// Delete a memory
app.delete('/api/memories/:id', (req, res) => {
  memory.deleteMemory(parseInt(req.params.id));
  res.json({ deleted: true });
});

// Get conversation sessions
app.get('/api/sessions', (req, res) => {
  res.json(memory.getAllSessions());
});

// Get stats
app.get('/api/stats', (req, res) => {
  res.json(memory.getStats());
});

// Available commands
app.get('/api/commands', (req, res) => {
  res.json(commander.getAvailableCommands());
});

// Health check (also checks Ollama connectivity)
app.get('/api/health', async (req, res) => {
  let ollamaStatus = 'unknown';
  try {
    const resp = await fetch(`${CONFIG.ollamaUrl}/api/tags`);
    if (resp.ok) {
      const data = await resp.json();
      ollamaStatus = `connected (${data.models?.length || 0} models)`;
    } else {
      ollamaStatus = 'error: ' + resp.status;
    }
  } catch (e) {
    ollamaStatus = 'unreachable: ' + e.message;
  }

  res.json({
    status: 'running',
    ollama: ollamaStatus,
    model: CONFIG.model,
    ...memory.getStats()
  });
});

// ── Quant API Endpoints ──

app.get('/api/quant/market', async (req, res) => {
  try {
    const snap = await getMarketSnapshot();
    res.json(snap);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quant/quote/:ticker', async (req, res) => {
  try {
    const q = await getQuote(req.params.ticker);
    res.json(q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quant/analyze/:ticker', async (req, res) => {
  try {
    const a = await analyzeStock(req.params.ticker);
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quant/chart/:ticker', async (req, res) => {
  try {
    const range = req.query.range || '6mo';
    const chart = await getChartData(req.params.ticker, range);
    res.json(chart);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quant/momentum', async (req, res) => {
  try {
    const n = parseInt(req.query.n) || 10;
    const picks = await momentumScan(n);
    res.json(picks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quant/dislocations', async (req, res) => {
  try {
    const n = parseInt(req.query.n) || 10;
    const picks = await dislocations(n);
    res.json(picks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quant/backtest/:ticker', async (req, res) => {
  try {
    const bt = await backtestRSI(req.params.ticker);
    res.json(bt);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quant/sentiment/:ticker', async (req, res) => {
  try {
    const s = await getSentiment(req.params.ticker);
    res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quant/moonshots', async (req, res) => {
  try {
    const picks = await findMoonshots();
    res.json(picks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quant/watchlist', (req, res) => {
  res.json(WATCHLIST);
});

// ── Advanced Feature Endpoints ──

// Reminders
app.get('/api/reminders', (req, res) => {
  res.json(reminders.getAll());
});

app.post('/api/reminders', (req, res) => {
  const { content, due_at, repeat } = req.body;
  if (!content || !due_at) return res.status(400).json({ error: 'Need content and due_at' });
  res.json(reminders.add(content, due_at, repeat || null));
});

app.delete('/api/reminders/:id', (req, res) => {
  res.json(reminders.remove(parseInt(req.params.id)));
});

// Mood
app.get('/api/mood', (req, res) => {
  res.json(mood.getCurrentMood());
});

app.get('/api/mood/history', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  res.json(mood.getHistory(days));
});

app.get('/api/mood/daily', (req, res) => {
  res.json(mood.getDailySummary());
});

// Summaries
app.get('/api/summaries', (req, res) => {
  res.json(summaries.getRecent(parseInt(req.query.days) || 7));
});

app.post('/api/summaries/generate', async (req, res) => {
  try {
    const date = req.body.date || null;
    const result = await summaries.generateSummary(date);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// File search
app.get('/api/files/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Need ?q=query' });
  const paths = req.query.paths ? req.query.paths.split(',') : null;
  res.json(fileSearch.search(q, paths));
});

app.get('/api/files/info', (req, res) => {
  res.json(fileSearch.getSearchableInfo());
});

// Journal
app.get('/api/journal', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  res.json(journal.getEntries(days));
});

app.get('/api/journal/today', (req, res) => {
  res.json(journal.getToday());
});

app.get('/api/journal/prompt', (req, res) => {
  res.json({ prompt: journal.getPrompt() });
});

app.get('/api/journal/streak', (req, res) => {
  res.json(journal.getStreak());
});

app.get('/api/journal/weekly', (req, res) => {
  res.json(journal.getWeeklyReflection());
});

app.get('/api/journal/pinned', (req, res) => {
  res.json(journal.getPinned());
});

app.get('/api/journal/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Need ?q=query' });
  res.json(journal.search(q));
});

app.get('/api/journal/:id', (req, res) => {
  const entry = journal.getEntry(parseInt(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json(entry);
});

app.post('/api/journal', (req, res) => {
  const { content, prompt, mood_score, mood_label } = req.body;
  if (!content) return res.status(400).json({ error: 'Need content' });
  res.json(journal.write(content, prompt, mood_score, mood_label));
});

app.put('/api/journal/:id', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Need content' });
  res.json(journal.edit(parseInt(req.params.id), content));
});

app.delete('/api/journal/:id', (req, res) => {
  res.json(journal.delete(parseInt(req.params.id)));
});

app.post('/api/journal/:id/pin', (req, res) => {
  const result = journal.togglePin(parseInt(req.params.id));
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

// ── Productivity Endpoints ──

// Todos
app.get('/api/todos', (req, res) => res.json(todos.getAll(req.query.status)));
app.get('/api/todos/stats', (req, res) => res.json(todos.getStats()));
app.get('/api/todos/overdue', (req, res) => res.json(todos.getOverdue()));
app.get('/api/todos/projects', (req, res) => res.json(todos.getProjects()));
app.post('/api/todos', (req, res) => {
  const { content, project, priority, due_date, tags } = req.body;
  if (!content) return res.status(400).json({ error: 'Need content' });
  res.json(todos.add(content, project, priority, due_date, tags));
});
app.put('/api/todos/:id', (req, res) => res.json(todos.edit(parseInt(req.params.id), req.body)));
app.post('/api/todos/:id/complete', (req, res) => res.json(todos.complete(parseInt(req.params.id))));
app.post('/api/todos/:id/start', (req, res) => res.json(todos.start(parseInt(req.params.id))));
app.delete('/api/todos/:id', (req, res) => res.json(todos.delete(parseInt(req.params.id))));

// Habits
app.get('/api/habits', (req, res) => res.json(habits.getDashboard()));
app.get('/api/habits/today', (req, res) => res.json(habits.getTodayStatus()));
app.post('/api/habits', (req, res) => {
  const { name, icon, frequency, target } = req.body;
  if (!name) return res.status(400).json({ error: 'Need name' });
  res.json(habits.addHabit(name, icon, frequency, target));
});
app.post('/api/habits/:id/check', (req, res) => res.json(habits.checkIn(parseInt(req.params.id), req.body.date)));
app.post('/api/habits/:id/uncheck', (req, res) => res.json(habits.uncheck(parseInt(req.params.id), req.body.date)));
app.delete('/api/habits/:id', (req, res) => res.json(habits.deleteHabit(parseInt(req.params.id))));

// Pomodoro
app.post('/api/pomodoro/start', (req, res) => res.json(pomodoro.start('rest', req.body.task, req.body.duration)));
app.post('/api/pomodoro/stop', (req, res) => res.json(pomodoro.stop('rest')));
app.get('/api/pomodoro/today', (req, res) => res.json(pomodoro.getTodayStats()));
app.get('/api/pomodoro/week', (req, res) => res.json(pomodoro.getWeekStats()));

// Goals
app.get('/api/goals', (req, res) => res.json(goals.getAll(req.query.status || 'active')));
app.post('/api/goals', (req, res) => {
  const { title, description, target_date, category } = req.body;
  if (!title) return res.status(400).json({ error: 'Need title' });
  res.json(goals.addGoal(title, description, target_date, category));
});
app.get('/api/goals/:id', (req, res) => {
  const g = goals.getGoal(parseInt(req.params.id));
  if (!g) return res.status(404).json({ error: 'Not found' });
  res.json(g);
});
app.post('/api/goals/:id/progress', (req, res) => res.json(goals.updateProgress(parseInt(req.params.id), req.body.progress)));
app.post('/api/goals/:id/milestone', (req, res) => res.json(goals.addMilestone(parseInt(req.params.id), req.body.title)));
app.post('/api/milestones/:id/complete', (req, res) => res.json(goals.completeMilestone(parseInt(req.params.id))));
app.delete('/api/goals/:id', (req, res) => res.json(goals.deleteGoal(parseInt(req.params.id))));

// Bookmarks
app.get('/api/bookmarks', (req, res) => res.json(bookmarks.getAll()));
app.post('/api/bookmarks', (req, res) => {
  const { content, note, tags, session_id } = req.body;
  if (!content) return res.status(400).json({ error: 'Need content' });
  res.json(bookmarks.save(content, note, tags, session_id));
});
app.get('/api/bookmarks/search', (req, res) => res.json(bookmarks.search(req.query.q || '')));
app.delete('/api/bookmarks/:id', (req, res) => res.json(bookmarks.delete(parseInt(req.params.id))));

// Knowledge Base
app.get('/api/kb', (req, res) => res.json(kb.getAll(req.query.type)));
app.get('/api/kb/stats', (req, res) => res.json(kb.getStats()));
app.post('/api/kb', (req, res) => {
  const { title, content, type, language, tags } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Need title and content' });
  res.json(kb.add(title, content, type, language, tags));
});
app.get('/api/kb/search', (req, res) => res.json(kb.search(req.query.q || '')));
app.get('/api/kb/:id', (req, res) => {
  const item = kb.get(parseInt(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});
app.put('/api/kb/:id', (req, res) => res.json(kb.update(parseInt(req.params.id), req.body.content)));
app.delete('/api/kb/:id', (req, res) => res.json(kb.delete(parseInt(req.params.id))));

// Achievements
app.get('/api/achievements', (req, res) => res.json(achievements.getAll()));
app.get('/api/achievements/progress', (req, res) => res.json(achievements.getProgress()));

// Insights
app.get('/api/insights', (req, res) => res.json(insightEngine.generate()));

// Daily Briefing
app.get('/api/briefing', async (req, res) => {
  try {
    const result = await briefing.generate({
      mood: mood.getCurrentMood(),
      reminders: reminders.getUpcoming(120),
      todos: todos.getStats(),
      habits: habits.getTodayStatus(),
      goals: goals.getAll('active'),
      journalStreak: journal.getStreak(),
      pomodoro: pomodoro.getTodayStats(),
      achievements: achievements.getProgress(),
      insights: insightEngine.generate(),
    });
    res.json({ briefing: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Dashboard (aggregate stats)
app.get('/api/dashboard', (req, res) => {
  res.json({
    mood: mood.getCurrentMood(),
    todos: todos.getStats(),
    habits: habits.getTodayStatus(),
    journal: journal.getStreak(),
    pomodoro: pomodoro.getTodayStats(),
    goals: goals.getAll('active').slice(0, 3),
    achievements: achievements.getProgress(),
    reminders: reminders.getUpcoming(60),
    memory: memory.getStats(),
  });
});

// ── WebSocket (streaming chat) ──

wss.on('connection', (ws) => {
  let sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let currentPersonality = 'default';

  console.log(`[WS] New connection: ${sessionId}`);
  reminders.addListener(ws);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', content: 'Invalid JSON' }));
      return;
    }

    // Handle different message types
    switch (msg.type) {
      case 'chat':
        // Check for slash commands first
        const slashResult = await handleSlashCommand(ws, msg.content, sessionId);
        if (slashResult) break; // Slash command handled it
        await handleChat(ws, sessionId, currentPersonality, msg.content);
        break;

      case 'set_personality':
        if (personalities[msg.personality]) {
          currentPersonality = msg.personality;
          const p = personalities[currentPersonality];
          ws.send(JSON.stringify({
            type: 'personality_changed',
            personality: currentPersonality,
            greeting: p.greeting,
            style: p.style
          }));
        }
        break;

      case 'set_session':
        sessionId = msg.session_id || sessionId;
        ws.send(JSON.stringify({ type: 'session_set', session_id: sessionId }));
        break;

      case 'save_memory':
        const result = memory.saveMemory(
          msg.content,
          msg.category || 'general',
          msg.importance || 5,
          'explicit'
        );
        ws.send(JSON.stringify({ type: 'memory_saved', ...result }));
        break;

      case 'get_history':
        const history = memory.getConversationHistory(sessionId, msg.limit || 50);
        ws.send(JSON.stringify({ type: 'history', messages: history }));
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', content: `Unknown type: ${msg.type}` }));
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Disconnected: ${sessionId}`);
  });
});

// ── Slash Command Handler (direct quant commands from chat) ──

async function handleSlashCommand(ws, content, sessionId) {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) return false;

  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const arg = parts.slice(1).join(' ').toUpperCase();

  let result;
  try {
    switch (cmd) {
      case 'market':
      case 'snapshot': {
        ws.send(JSON.stringify({ type: 'system_msg', content: '📊 Fetching market snapshot...' }));
        const snap = await getMarketSnapshot();
        result = formatMarketSnapshot(snap);
        ws.send(JSON.stringify({ type: 'chart_data', data: null })); // clear chart
        break;
      }
      case 'quote':
      case 'q': {
        if (!arg) { result = '⚠ Usage: /quote TICKER'; break; }
        ws.send(JSON.stringify({ type: 'system_msg', content: `💹 Fetching ${arg}...` }));
        const q = await getQuote(arg);
        result = q.error ? `⚠ ${q.error}` : formatQuote(q);
        break;
      }
      case 'analyze':
      case 'quant': {
        if (!arg) { result = '⚠ Usage: /analyze TICKER'; break; }
        ws.send(JSON.stringify({ type: 'system_msg', content: `🧠 Running quant analysis on ${arg}...` }));
        const a = await analyzeStock(arg);
        result = a.error ? `⚠ ${a.error}` : formatAnalysis(a);
        // Send chart data for frontend rendering
        if (!a.error && a.data) {
          const chart = await getChartData(arg);
          ws.send(JSON.stringify({ type: 'chart_data', data: chart }));
        }
        break;
      }
      case 'chart': {
        if (!arg) { result = '⚠ Usage: /chart TICKER [range]'; break; }
        const ticker = parts[1]?.toUpperCase();
        const range = parts[2] || '6mo';
        ws.send(JSON.stringify({ type: 'system_msg', content: `📈 Loading ${ticker} chart (${range})...` }));
        const chart = await getChartData(ticker, range);
        if (chart.error) { result = `⚠ ${chart.error}`; break; }
        ws.send(JSON.stringify({ type: 'chart_data', data: chart }));
        result = `📈 Chart loaded for ${ticker} (${range}) — ${chart.close.length} data points`;
        break;
      }
      case 'momentum':
      case 'momo': {
        ws.send(JSON.stringify({ type: 'system_msg', content: '🚀 Scanning momentum leaders...' }));
        const picks = await momentumScan(parseInt(arg) || 10);
        result = formatMomentum(picks);
        break;
      }
      case 'dislocate':
      case 'value': {
        ws.send(JSON.stringify({ type: 'system_msg', content: '🔍 Scanning for dislocations...' }));
        const picks = await dislocations(parseInt(arg) || 10);
        result = formatDislocations(picks);
        break;
      }
      case 'backtest':
      case 'bt': {
        if (!arg) { result = '⚠ Usage: /backtest TICKER'; break; }
        ws.send(JSON.stringify({ type: 'system_msg', content: `📊 Backtesting RSI strategy on ${arg}...` }));
        const bt = await backtestRSI(arg);
        result = bt.error ? `⚠ ${bt.error}` : formatBacktest(bt);
        break;
      }
      case 'sentiment':
      case 'news': {
        if (!arg) { result = '⚠ Usage: /sentiment TICKER'; break; }
        ws.send(JSON.stringify({ type: 'system_msg', content: `📰 Scanning sentiment for ${arg}...` }));
        const s = await getSentiment(arg);
        result = formatSentiment(s);
        break;
      }
      case 'moonshot':
      case 'moon': {
        ws.send(JSON.stringify({ type: 'system_msg', content: '🚀 Scanning moonshot radar...' }));
        const picks = await findMoonshots();
        result = formatMoonshots(picks);
        break;
      }

      // ── Advanced Feature Commands ──

      case 'remind':
      case 'reminder': {
        if (!arg) {
          // Show pending reminders
          const all = reminders.getAll();
          if (!all.length) { result = '📭 No pending reminders.'; break; }
          result = '⏰ **Pending Reminders:**\n\n';
          for (const r of all) {
            result += `\`#${r.id}\` ${r.content} — **${r.due_at}**${r.repeat ? ` (${r.repeat})` : ''}\n`;
          }
          break;
        }
        // Try to parse: /remind in 10 minutes check the market
        const fullText = parts.slice(1).join(' ');
        const dueAt = parseReminderTime(fullText);
        if (!dueAt) {
          result = '⚠ Could not parse time. Try: `/remind in 10 minutes check email` or `/remind at 3:00pm meeting`';
          break;
        }
        const repeat = parseRepeat(fullText);
        // Extract the actual reminder content (remove time parts)
        const reminderContent = fullText
          .replace(/in\s+\d+\s*\w+/i, '')
          .replace(/at\s+\d{1,2}:\d{2}\s*(am|pm)?/i, '')
          .replace(/tomorrow/i, '')
          .replace(/every\s*\w+/i, '')
          .trim() || fullText;
        const rem = reminders.add(reminderContent, dueAt, repeat);
        result = `⏰ Reminder set: "${rem.content}" — ${rem.due_at}${rem.repeat ? ` (repeats ${rem.repeat})` : ''}`;
        break;
      }
      case 'cancelremind':
      case 'delremind': {
        const id = parseInt(arg);
        if (!id) { result = '⚠ Usage: /cancelremind ID'; break; }
        reminders.remove(id);
        result = `✅ Reminder #${id} cancelled.`;
        break;
      }

      case 'mood': {
        const current = mood.getCurrentMood();
        const daily = mood.getDailySummary();
        result = `**${current.label}** (score: ${current.score}) — trend: ${current.trend}\n\n`;
        if (daily.length) {
          result += '**Last 7 days:**\n';
          for (const d of daily.slice(0, 7)) {
            const label = mood.scoreToLabel(d.avg_score);
            const triggers = d.all_triggers ? ` [${d.all_triggers}]` : '';
            result += `${d.day}: ${label} (${d.entries} msgs)${triggers}\n`;
          }
        }
        break;
      }

      case 'summary':
      case 'digest': {
        const date = arg ? parts[1] : null;
        ws.send(JSON.stringify({ type: 'system_msg', content: '📝 Generating summary...' }));
        const sum = await summaries.generateSummary(date);
        result = `**📝 Summary for ${sum.date}** (${sum.message_count} messages)\n\n${sum.summary}`;
        if (sum.topics?.length) result += `\n\n**Topics:** ${Array.isArray(sum.topics) ? sum.topics.join(', ') : sum.topics}`;
        break;
      }
      case 'history': {
        const recent = summaries.getRecent(7);
        if (!recent.length) { result = '📭 No summaries yet. Use `/summary` to generate one.'; break; }
        result = '**📝 Recent Summaries:**\n\n';
        for (const s of recent) {
          result += `**${s.date}** (${s.message_count} msgs): ${s.summary.substring(0, 120)}...\n`;
        }
        break;
      }

      case 'find':
      case 'search':
      case 'files': {
        if (!arg) { result = '⚠ Usage: /find filename or keyword'; break; }
        ws.send(JSON.stringify({ type: 'system_msg', content: `🔍 Searching files for "${parts.slice(1).join(' ')}"...` }));
        const query = parts.slice(1).join(' ');
        const results_arr = fileSearch.search(query);
        result = formatFileResults(results_arr, query);
        break;
      }

      // ── Journal ──

      case 'journal':
      case 'j': {
        const sub = parts[1]?.toLowerCase();

        if (!sub || sub === 'list' || sub === 'recent') {
          const entries = journal.getEntries(7);
          result = formatJournalList(entries);
          break;
        }

        if (sub === 'write' || sub === 'new') {
          // Everything after "write" is the entry
          const content = parts.slice(2).join(' ').trim();
          if (!content) {
            const prompt = journal.getPrompt();
            result = `📓 **Journal Prompt:**\n\n_${prompt}_\n\nWrite your entry: \`/journal write your thoughts here...\``;
            break;
          }
          const currentMood = mood.getCurrentMood();
          const entry = journal.write(content, null, currentMood.score, currentMood.label);
          result = `📓 Entry saved! ${formatJournalEntry(entry)}`;
          break;
        }

        if (sub === 'prompt') {
          const prompt = journal.getPrompt();
          result = `📓 **Today's Prompt:**\n\n_${prompt}_\n\nRespond with: \`/journal write your response...\``;
          break;
        }

        if (sub === 'streak') {
          result = formatStreak(journal.getStreak());
          break;
        }

        if (sub === 'weekly' || sub === 'reflection' || sub === 'reflect') {
          result = formatWeeklyReflection(journal.getWeeklyReflection());
          break;
        }

        if (sub === 'pinned' || sub === 'pins') {
          const pinned = journal.getPinned();
          if (!pinned.length) { result = '📌 No pinned entries.'; break; }
          result = '📌 **Pinned Entries:**\n\n';
          for (const e of pinned) result += formatJournalEntry(e) + '\n\n';
          break;
        }

        if (sub === 'pin') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /journal pin ID'; break; }
          const pinResult = journal.togglePin(id);
          if (!pinResult) { result = '⚠ Entry not found.'; break; }
          result = pinResult.pinned ? `📌 Entry #${id} pinned.` : `Entry #${id} unpinned.`;
          break;
        }

        if (sub === 'delete' || sub === 'del') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /journal delete ID'; break; }
          journal.delete(id);
          result = `🗑️ Entry #${id} deleted.`;
          break;
        }

        if (sub === 'read' || sub === 'view') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /journal read ID'; break; }
          const entry = journal.getEntry(id);
          if (!entry) { result = '⚠ Entry not found.'; break; }
          result = formatJournalEntry(entry);
          break;
        }

        if (sub === 'search' || sub === 'find') {
          const q = parts.slice(2).join(' ');
          if (!q) { result = '⚠ Usage: /journal search keyword'; break; }
          const found = journal.search(q);
          result = formatJournalList(found);
          break;
        }

        if (sub === 'today') {
          const today = journal.getToday();
          if (!today.length) { result = '📓 No entries today. Try `/journal write` or `/journal prompt`.'; break; }
          result = `📓 **Today's Entries:**\n\n`;
          for (const e of today) result += formatJournalEntry(e) + '\n\n';
          break;
        }

        // Default: treat as a write
        const content = parts.slice(1).join(' ').trim();
        if (content) {
          const currentMood = mood.getCurrentMood();
          const entry = journal.write(content, null, currentMood.score, currentMood.label);
          result = `📓 Entry saved! ${formatJournalEntry(entry)}`;
        } else {
          result = formatJournalList(journal.getEntries(7));
        }
        break;
      }

      // ── Todo ──

      case 'todo':
      case 'task':
      case 't': {
        const sub = parts[1]?.toLowerCase();
        if (!sub || sub === 'list') {
          result = formatTodoList(todos.getAll(), 'All Tasks');
          break;
        }
        if (sub === 'add' || sub === 'new') {
          const rest = parts.slice(2).join(' ');
          if (!rest) { result = '⚠ Usage: /todo add Buy groceries'; break; }
          // Parse priority: p1, p2, p3, p4
          let priority = 2;
          const prioMatch = rest.match(/\bp([1-4])\b/i);
          if (prioMatch) priority = parseInt(prioMatch[1]);
          // Parse project: #project
          let project = 'inbox';
          const projMatch = rest.match(/#(\w+)/);
          if (projMatch) project = projMatch[1];
          // Parse due: @tomorrow, @2026-02-20
          let due = null;
          const dueMatch = rest.match(/@(\S+)/);
          if (dueMatch) {
            if (dueMatch[1] === 'today') due = new Date().toISOString().slice(0, 10);
            else if (dueMatch[1] === 'tomorrow') due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
            else due = dueMatch[1];
          }
          const content = rest.replace(/\bp[1-4]\b/i, '').replace(/#\w+/, '').replace(/@\S+/, '').trim();
          const t = todos.add(content, project, priority, due);
          result = `✅ Task added: ${formatTodo(t)}`;
          break;
        }
        if (sub === 'done' || sub === 'complete') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /todo done ID'; break; }
          const t = todos.complete(id);
          result = t ? `✅ Completed: ${formatTodo(t)}` : '⚠ Task not found';
          break;
        }
        if (sub === 'start' || sub === 'doing') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /todo start ID'; break; }
          const t = todos.start(id);
          result = t ? `🔄 Started: ${formatTodo(t)}` : '⚠ Task not found';
          break;
        }
        if (sub === 'del' || sub === 'delete' || sub === 'rm') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /todo del ID'; break; }
          todos.delete(id);
          result = `🗑️ Task #${id} deleted.`;
          break;
        }
        if (sub === 'overdue') { result = formatTodoList(todos.getOverdue(), 'Overdue Tasks'); break; }
        if (sub === 'today') { result = formatTodoList(todos.getToday(), "Today's Tasks"); break; }
        if (sub === 'projects') {
          const projs = todos.getProjects();
          result = '📁 **Projects:**\n\n' + projs.map(p => `• **${p.project}** (${p.done}/${p.count} done)`).join('\n');
          break;
        }
        if (sub === 'stats') {
          const s = todos.getStats();
          result = `📋 **Task Stats:** ${s.active} active, ${s.done} done, ${s.overdue} overdue, ${s.today_done} today, ${s.completion_rate}% completion`;
          break;
        }
        // Treat as quick-add
        const content = parts.slice(1).join(' ').trim();
        if (content) {
          const t = todos.add(content);
          result = `✅ Task added: ${formatTodo(t)}`;
        }
        break;
      }

      // ── Habits ──

      case 'habit':
      case 'habits': {
        const sub = parts[1]?.toLowerCase();
        if (!sub || sub === 'list' || sub === 'dashboard') {
          result = formatHabitDashboard(habits.getDashboard());
          break;
        }
        if (sub === 'add' || sub === 'new') {
          const name = parts.slice(2).join(' ').trim();
          if (!name) { result = '⚠ Usage: /habit add Exercise'; break; }
          const h = habits.addHabit(name);
          result = `🔄 Habit created: **${h.name}** (${h.frequency})`;
          break;
        }
        if (sub === 'check' || sub === 'done') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /habit check ID'; break; }
          const r = habits.checkIn(id);
          result = r.checked ? `✅ Checked in! Streak: 🔥${habits.getStreak(id)}` : '⚠ Already checked today';
          break;
        }
        if (sub === 'uncheck') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /habit uncheck ID'; break; }
          habits.uncheck(id);
          result = '↩️ Unchecked.';
          break;
        }
        if (sub === 'del' || sub === 'delete') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /habit del ID'; break; }
          habits.deleteHabit(id);
          result = `🗑️ Habit #${id} deleted.`;
          break;
        }
        break;
      }

      // ── Pomodoro ──

      case 'pomo':
      case 'pomodoro':
      case 'focus': {
        const sub = parts[1]?.toLowerCase();
        if (sub === 'start' || (!sub && !pomodoro.getStatus(sessionId))) {
          const task = parts.slice(2).join(' ') || null;
          const dur = parseInt(parts.find(p => /^\d+$/.test(p))) || 25;
          const p = pomodoro.start(sessionId, task, dur);
          result = `🍅 **Focus started!** ${p.duration} min${p.task ? ` — "${p.task}"` : ''}\nType \`/pomo stop\` when done.`;
          // Schedule notification
          setTimeout(() => {
            const ended = pomodoro.stop(sessionId);
            if (ended) {
              ws.send(JSON.stringify({ type: 'system_msg', content: `🍅 **Pomodoro complete!** ${ended.elapsed_minutes} min focused${ended.task ? ` on "${ended.task}"` : ''}. Take a break!` }));
            }
          }, dur * 60 * 1000);
          break;
        }
        if (sub === 'stop' || sub === 'done') {
          const ended = pomodoro.stop(sessionId);
          if (!ended) { result = '⚠ No active pomodoro.'; break; }
          result = `🍅 **Stopped!** ${ended.elapsed_minutes} min focused${ended.task ? ` on "${ended.task}"` : ''}.`;
          break;
        }
        if (sub === 'status') {
          const s = pomodoro.getStatus(sessionId);
          if (!s) { result = '⚠ No active pomodoro. Start with `/pomo start`.'; break; }
          result = `🍅 **${s.remaining_display} remaining** ${s.task ? `— "${s.task}"` : ''}\n${s.done ? 'Time\'s up! 🎉' : 'Stay focused!'}`;
          break;
        }
        if (sub === 'stats' || sub === 'today') {
          const s = pomodoro.getTodayStats();
          result = `🍅 **Today:** ${s.sessions} sessions, ${s.total_display} focused`;
          break;
        }
        if (sub === 'week') {
          const s = pomodoro.getWeekStats();
          result = `🍅 **This week:** ${s.sessions} sessions, ${Math.floor(s.total_minutes / 60)}h ${s.total_minutes % 60}m`;
          break;
        }
        // Default — show status or prompt to start
        const status = pomodoro.getStatus(sessionId);
        if (status) {
          result = `🍅 **${status.remaining_display} remaining** ${status.task ? `— "${status.task}"` : ''}`;
        } else {
          result = `🍅 No active session. Start: \`/pomo start [task] [minutes]\``;
        }
        break;
      }

      // ── Goals ──

      case 'goal':
      case 'goals': {
        const sub = parts[1]?.toLowerCase();
        if (!sub || sub === 'list') {
          result = formatGoalList(goals.getAll('active'));
          break;
        }
        if (sub === 'add' || sub === 'new') {
          const title = parts.slice(2).join(' ').trim();
          if (!title) { result = '⚠ Usage: /goal add Learn Rust'; break; }
          const g = goals.addGoal(title);
          result = `🎯 Goal set: **${g.title}** — now add milestones with \`/goal ms ${g.id} milestone\``;
          break;
        }
        if (sub === 'ms' || sub === 'milestone') {
          const goalId = parseInt(parts[2]);
          const msTitle = parts.slice(3).join(' ').trim();
          if (!goalId || !msTitle) { result = '⚠ Usage: /goal ms GOAL_ID Milestone title'; break; }
          const g = goals.addMilestone(goalId, msTitle);
          result = g ? formatGoal(g) : '⚠ Goal not found.';
          break;
        }
        if (sub === 'check' || sub === 'done') {
          const msId = parseInt(parts[2]);
          if (!msId) { result = '⚠ Usage: /goal check MILESTONE_ID'; break; }
          const g = goals.completeMilestone(msId);
          result = g ? `✅ Milestone complete!\n${formatGoal(g)}` : '⚠ Milestone not found.';
          break;
        }
        if (sub === 'progress') {
          const goalId = parseInt(parts[2]);
          const pct = parseInt(parts[3]);
          if (!goalId || isNaN(pct)) { result = '⚠ Usage: /goal progress ID 50'; break; }
          const g = goals.updateProgress(goalId, pct);
          result = g ? formatGoal(g) : '⚠ Goal not found.';
          break;
        }
        if (sub === 'del' || sub === 'delete') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /goal del ID'; break; }
          goals.deleteGoal(id);
          result = `🗑️ Goal #${id} deleted.`;
          break;
        }
        break;
      }

      // ── Bookmarks ──

      case 'bookmark':
      case 'bm': {
        const sub = parts[1]?.toLowerCase();
        if (!sub || sub === 'list') {
          result = formatBookmarkList(bookmarks.getAll());
          break;
        }
        if (sub === 'save' || sub === 'add') {
          const content = parts.slice(2).join(' ').trim();
          if (!content) { result = '⚠ Usage: /bookmark save some text to remember'; break; }
          // Parse optional tags: #tag1 #tag2
          const tags = (content.match(/#\w+/g) || []).map(t => t.slice(1)).join(',');
          const cleanContent = content.replace(/#\w+/g, '').trim();
          const bm = bookmarks.save(cleanContent, null, tags || null, sessionId);
          result = `🔖 Bookmarked! (#${bm.id})`;
          break;
        }
        if (sub === 'search' || sub === 'find') {
          const q = parts.slice(2).join(' ');
          result = formatBookmarkList(bookmarks.search(q));
          break;
        }
        if (sub === 'del' || sub === 'delete') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /bookmark del ID'; break; }
          bookmarks.delete(id);
          result = `🗑️ Bookmark #${id} deleted.`;
          break;
        }
        break;
      }

      // ── Knowledge Base ──

      case 'kb':
      case 'knowledge': {
        const sub = parts[1]?.toLowerCase();
        if (!sub || sub === 'list') {
          result = formatKBList(kb.getAll());
          break;
        }
        if (sub === 'add' || sub === 'save') {
          // /kb add Title | Content
          const rest = parts.slice(2).join(' ');
          const pipeIdx = rest.indexOf('|');
          if (pipeIdx === -1) { result = '⚠ Usage: /kb add Title | Content here'; break; }
          const title = rest.slice(0, pipeIdx).trim();
          const content = rest.slice(pipeIdx + 1).trim();
          // Detect type
          let type = 'note';
          if (/^https?:\/\//i.test(content)) type = 'link';
          else if (/```|function |const |import |def |class /i.test(content)) type = 'snippet';
          const item = kb.add(title, content, type);
          result = `📚 Saved! ${TYPE_ICONS[type] || '📝'} **#${item.id} ${item.title}**`;
          break;
        }
        if (sub === 'search' || sub === 'find') {
          const q = parts.slice(2).join(' ');
          result = formatKBList(kb.search(q));
          break;
        }
        if (sub === 'read' || sub === 'view') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /kb read ID'; break; }
          const item = kb.get(id);
          if (!item) { result = '⚠ Not found.'; break; }
          result = `${TYPE_ICONS[item.type] || '📝'} **${item.title}**\n\n${item.content}`;
          break;
        }
        if (sub === 'del' || sub === 'delete') {
          const id = parseInt(parts[2]);
          if (!id) { result = '⚠ Usage: /kb del ID'; break; }
          kb.delete(id);
          result = `🗑️ KB item #${id} deleted.`;
          break;
        }
        break;
      }

      // ── Achievements, Insights, Briefing, Dashboard ──

      case 'achievements':
      case 'ach': {
        result = formatAchievements(achievements.getAll());
        break;
      }

      case 'insights':
      case 'insight': {
        result = formatInsights(insightEngine.generate());
        break;
      }

      case 'briefing':
      case 'brief':
      case 'morning':
      case 'gm': {
        ws.send(JSON.stringify({ type: 'system_msg', content: '☀️ Generating briefing...' }));
        result = await briefing.generate({
          mood: mood.getCurrentMood(),
          reminders: reminders.getUpcoming(120),
          todos: todos.getStats(),
          habits: habits.getTodayStatus(),
          goals: goals.getAll('active'),
          journalStreak: journal.getStreak(),
          pomodoro: pomodoro.getTodayStats(),
          achievements: achievements.getProgress(),
          insights: insightEngine.generate(),
        });
        break;
      }

      case 'dash':
      case 'dashboard': {
        const d = {
          mood: mood.getCurrentMood(),
          todos: todos.getStats(),
          habits: habits.getDashboard(),
          journalStreak: journal.getStreak(),
          pomodoro: pomodoro.getTodayStats(),
          goals: goals.getAll('active').slice(0, 3),
          achievements: achievements.getProgress(),
        };
        result = `**📊 VELLE.AI Dashboard**\n\n`;
        result += `**Mood:** ${d.mood.label} (${d.mood.trend})\n`;
        result += `**Tasks:** ${d.todos.active} active, ${d.todos.today_done} done today, ${d.todos.overdue} overdue\n`;
        result += `**Journal:** ${'🔥'.repeat(Math.min(d.journalStreak.current, 5))} ${d.journalStreak.current} day streak\n`;
        result += `**Focus:** ${d.pomodoro.total_display} today\n`;
        result += `**Achievements:** ${d.achievements.unlocked}/${d.achievements.total}\n\n`;
        if (d.habits.length) {
          result += '**Habits:**\n';
          for (const h of d.habits) {
            const weekViz = h.week.map(dd => dd.done ? '🟩' : '⬜').join('');
            result += `${h.completed_today ? '✅' : '☐'} ${h.icon} ${h.name} ${weekViz} ${h.streak > 0 ? '🔥' + h.streak : ''}\n`;
          }
          result += '\n';
        }
        if (d.goals.length) {
          result += '**Goals:**\n';
          for (const g of d.goals) result += `• ${g.title} ${'█'.repeat(Math.round(g.progress / 10))}${'░'.repeat(10 - Math.round(g.progress / 10))} ${g.progress}%\n`;
        }
        break;
      }

      case 'help': {
        result = `**📖 VELLE.AI Commands**

**📊 Quant** — /market /quote /analyze /chart /momentum /dislocate /backtest /sentiment /moonshot

**⏰ Reminders** — /remind [time] [task] /cancelremind ID

**🧠 Mood & Summaries** — /mood /summary /history

**📁 Files** — /find query

**📓 Journal** — /journal [write|prompt|today|streak|weekly|pin|read|search|delete]

**📋 Tasks** — /todo [add|done|start|del|overdue|today|projects|stats] (p1-p4 priority, #project, @due)

**🔄 Habits** — /habit [add|check|uncheck|del|dashboard]

**🍅 Focus** — /pomo [start|stop|status|stats|week]

**🎯 Goals** — /goal [add|ms|check|progress|del]

**🔖 Bookmarks** — /bookmark [save|search|del]

**📚 Knowledge** — /kb [add Title | Content|search|read|del]

**📊 Overview** — /dashboard /briefing /achievements /insights

Or just ask naturally. 😼`;
        break;
      }
      default:
        return false; // Not a known slash command
    }
  } catch (e) {
    result = `⚠ Error: ${e.message}`;
  }

  if (result) {
    ws.send(JSON.stringify({ type: 'slash_result', content: result }));
    return true;
  }
  return false;
}

// ── Chat Handler ──

async function handleChat(ws, sessionId, personalityId, userMessage) {
  const personality = personalities[personalityId] || personalities.default;

  // Build context from memory
  const context = memory.buildContext(sessionId, userMessage);

  // Construct memory section for system prompt
  let memorySection = '';
  if (context.memories.length > 0) {
    memorySection = '\n\n## Things you remember about the user:\n' +
      context.memories.map(m => `- [${m.category}] ${m.content}`).join('\n');
  }

  // Build command instructions
  const commandSection = `\n\n## Available Commands:
If the user asks you to perform an action on their system, respond with a JSON block containing the action.
Available actions: ${commander.getAvailableCommands().join(', ')}

Examples:
{"action": "open_browser", "url": "https://google.com"}
{"action": "open_app", "app": "powershell"}
{"action": "stock_quote", "ticker": "NVDA"}
{"action": "stock_analyze", "ticker": "AAPL"}
{"action": "market_snapshot"}
{"action": "momentum_scan", "n": "10"}
{"action": "sentiment", "ticker": "TSLA"}
{"action": "backtest", "ticker": "AMD"}
{"action": "moonshot_scan"}
{"action": "run_shell", "command": "Get-Process | Select -First 10"}
{"action": "run_shell", "command": "ipconfig"}
{"action": "run_shell", "command": "Get-Date"}

IMPORTANT for run_shell:
- This system runs Windows with PowerShell. Use PowerShell/Windows commands, NOT bash/Linux.
- If the user says "run shell" or "run a command" without specifying what, ASK them what command they want to run. Do NOT guess.
- Only output a command JSON when you know the specific command to execute.
- Valid examples: dir, ipconfig, Get-Process, Get-Date, systeminfo, hostname, tasklist, whoami, Get-ChildItem, ping
- NEVER use: rm, del, format, shutdown, restart, kill, Remove-Item, or any destructive commands.`;

  // If this is Kabuneko personality or user mentions stocks, enrich with market context
  let quantContext = '';
  const isFinanceQuery = /\b(stock|market|trade|crypto|bull|bear|portfolio|ticker|price|chart|analysis|momentum|rsi|backtest|earnings|sentiment)\b/i.test(userMessage);
  const isKabuneko = personalityId === 'kabuneko';

  // ── Mood + Reminder context (always inject) ──
  const currentMood = mood.getCurrentMood();
  const upcomingReminders = reminders.getUpcoming(30);
  let advancedContext = `\n\n## User Mood: ${currentMood.label} (trend: ${currentMood.trend})`;
  if (currentMood.score < -0.3) {
    advancedContext += '\nThe user seems down — be extra supportive and encouraging.';
  }
  if (upcomingReminders.length) {
    advancedContext += '\n\n## Upcoming Reminders:';
    for (const r of upcomingReminders.slice(0, 3)) {
      advancedContext += `\n- "${r.content}" due at ${r.due_at}`;
    }
  }

  if (isKabuneko || isFinanceQuery) {
    // Check if user is asking about a specific ticker
    const tickerMatch = userMessage.match(/\$?([A-Z]{2,5})\b/);
    if (tickerMatch) {
      const ticker = tickerMatch[1];
      try {
        const q = await getQuote(ticker);
        if (!q.error) {
          quantContext = `\n\n## Live Market Data (just fetched):
${ticker}: $${q.price?.toFixed(2)} (${q.change_pct >= 0 ? '+' : ''}${q.change_pct}%) | PE: ${q.pe?.toFixed(1) ?? 'n/a'} | MC: $${q.market_cap ? (q.market_cap / 1e9).toFixed(1) + 'B' : 'n/a'}
Use this data in your response. If the user wants deeper analysis, suggest they use /analyze ${ticker} or /chart ${ticker}.`;
        }
      } catch { /* skip if fetch fails */ }
    }
  }

  // Build messages array
  const messages = [
    {
      role: 'system',
      content: personality.system_prompt + memorySection + advancedContext + quantContext + commandSection
    },
    ...context.history,
    { role: 'user', content: userMessage }
  ];

  // Save user message
  memory.saveMessage(sessionId, 'user', userMessage, personalityId);

  // Stream from Ollama
  try {
    const response = await fetch(`${CONFIG.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CONFIG.model,
        messages,
        stream: true,
        options: {
          temperature: personality.temperature,
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      ws.send(JSON.stringify({
        type: 'error',
        content: `Ollama error (${response.status}): ${err}`
      }));
      return;
    }

    ws.send(JSON.stringify({ type: 'stream_start' }));

    let fullResponse = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            fullResponse += data.message.content;
            ws.send(JSON.stringify({
              type: 'stream_token',
              content: data.message.content
            }));
          }
          if (data.done) {
            // Save assistant response
            memory.saveMessage(sessionId, 'assistant', fullResponse, personalityId);

            // Check for commands in response
            const commands = commander.extractCommands(fullResponse);
            for (const cmd of commands) {
              const cmdResult = await commander.execute(cmd.action, cmd);
              ws.send(JSON.stringify({
                type: 'command_result',
                action: cmd.action,
                ...cmdResult
              }));
            }

            // Check for "remember" patterns in user message
            await autoExtractMemories(userMessage, fullResponse, ws, sessionId);

            // Check achievements
            try {
              const hour = new Date().getHours();
              const stats = {
                messages: memory.getStats().conversations,
                memories: memory.getStats().memories,
                journal_entries: journal.getStreak().total_entries,
                journal_streak: journal.getStreak().current,
                todos_done: todos.getStats().done,
                habits: habits.getAllHabits().length,
                max_habit_streak: Math.max(0, ...habits.getAllHabits().map(h => habits.getStreak(h.id))),
                pomodoros: pomodoro.getWeekStats().sessions,
                goals: goals.getAll('active').length + goals.getAll('completed').length,
                goals_done: goals.getAll('completed').length,
                kb_items: kb.getStats().total,
                bookmarks: bookmarks.getAll().length,
                night_messages: hour >= 0 && hour < 5 ? 1 : 0,
                early_messages: hour >= 5 && hour < 6 ? 1 : 0,
              };
              const newAch = achievements.checkAndUnlock(stats);
              for (const a of newAch) {
                ws.send(JSON.stringify({
                  type: 'achievement_unlocked',
                  icon: a.icon,
                  name: a.name,
                  desc: a.desc,
                }));
              }
            } catch (e) { console.warn('[Achievements] Check error:', e.message); }

            ws.send(JSON.stringify({
              type: 'stream_end',
              full_content: fullResponse,
              model: data.model,
              eval_duration: data.eval_duration,
              total_duration: data.total_duration
            }));
          }
        } catch { /* skip parse errors on partial chunks */ }
      }
    }
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'error',
      content: `Connection error: ${err.message}. Is Ollama running at ${CONFIG.ollamaUrl}?`
    }));
  }
}

// ── Auto-extract memories from user messages (with auto-tagging) ──

async function autoExtractMemories(userMessage, assistantResponse, ws, sessionId) {
  const lower = userMessage.toLowerCase();

  // ── Mood tracking (every user message) ──
  const moodResult = mood.track(userMessage, sessionId);

  // Explicit "remember" triggers
  const rememberPatterns = [
    /remember (?:that |this:? ?)(.+)/i,
    /don'?t forget:? ?(.+)/i,
    /note (?:that |this:? ?)(.+)/i,
    /save (?:this|that):? ?(.+)/i,
    /my (?:name is|favorite|preference) (.+)/i,
  ];

  for (const pattern of rememberPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const fact = match[1].trim();
      const tags = autoTagMemory(fact);
      const importance = autoImportance(fact, tags[0]);
      const result = memory.saveMemory(fact, tags[0], importance, 'auto');
      ws.send(JSON.stringify({
        type: 'memory_auto_saved',
        content: fact,
        category: tags[0],
        tags,
        ...result
      }));
      return;
    }
  }

  // Auto-detect preference patterns
  const prefPatterns = [
    /i (?:really )?(?:love|like|enjoy|prefer) (.+)/i,
    /i (?:hate|dislike|can't stand) (.+)/i,
    /i work (?:at|for|on) (.+)/i,
    /i live (?:in|at|near) (.+)/i,
    /i'm (?:a |an )?(\w+ (?:developer|engineer|designer|writer|student|teacher|manager))/i,
    /my (?:name|birthday|email|phone|address) (?:is |was )(.+)/i,
    /i (?:just )?(?:started|finished|completed|began) (.+)/i,
    /i(?:'m| am) (?:working on|building|learning|studying) (.+)/i,
    /i (?:need to|want to|plan to|going to) (.+)/i,
  ];

  for (const pattern of prefPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const fact = userMessage.replace(/^(hey|hi|so|well|okay|um)\s+/i, '').trim();
      const tags = autoTagMemory(fact);
      const importance = autoImportance(fact, tags[0]);
      memory.saveMemory(fact, tags[0], importance, 'auto');
      // Silent save — don't notify for auto-detected preferences
      break;
    }
  }

  // ── Proactive reminder detection from natural language ──
  const reminderPatterns = [
    /remind me (?:to )?(.+?)(?:\s+(?:in|at|tomorrow|every)\b.+)/i,
    /don'?t let me forget (?:to )?(.+)/i,
    /set (?:a )?reminder (?:to |for )?(.+)/i,
  ];

  for (const pattern of reminderPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const dueAt = parseReminderTime(userMessage);
      if (dueAt) {
        const repeat = parseRepeat(userMessage);
        const content = match[1].trim();
        const rem = reminders.add(content, dueAt, repeat);
        ws.send(JSON.stringify({
          type: 'reminder_set',
          ...rem
        }));
      }
      break;
    }
  }
}

// ── Start ──

server.listen(CONFIG.port, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║         ⚡ VELLE.AI — ONLINE            ║
  ╠══════════════════════════════════════════╣
  ║  Server:  http://localhost:${CONFIG.port}          ║
  ║  Ollama:  ${CONFIG.ollamaUrl.padEnd(28)}║
  ║  Model:   ${CONFIG.model.padEnd(28)}║
  ║  DB:      companion.db                  ║
  ╚══════════════════════════════════════════╝
  `);
});
