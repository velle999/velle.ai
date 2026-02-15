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
} from './advanced.js';
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

// Start reminder scheduler
reminders.startAll();
reminders.startPeriodicCheck();

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
        const slashResult = await handleSlashCommand(ws, msg.content);
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

async function handleSlashCommand(ws, content) {
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

      case 'help': {
        result = `**📖 VELLE.AI Commands**

**📊 Quant**
/market — Market snapshot
/quote TICKER — Price quote
/analyze TICKER — Full quant analysis
/chart TICKER [range] — Chart (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y)
/momentum [N] — Momentum leaders
/dislocate [N] — Value dislocations
/backtest TICKER — RSI backtest
/sentiment TICKER — News sentiment
/moonshot — Breakout radar

**⏰ Reminders**
/remind in 10 min check email — Set a reminder
/remind at 3:00pm meeting — Schedule by time
/remind — Show all pending
/cancelremind ID — Cancel a reminder

**🧠 Memory & Mood**
/mood — Current mood + 7-day trend
/summary [date] — Generate daily digest
/history — Recent summaries

**📁 Files**
/find query — Search local files by name/content

Or just ask naturally — VELLE.AI knows all these tools. 😼`;
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
