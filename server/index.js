import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MemoryManager } from './memory.js';
import { CommandExecutor } from './commands.js';
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

// ── WebSocket (streaming chat) ──

wss.on('connection', (ws) => {
  let sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let currentPersonality = 'default';

  console.log(`[WS] New connection: ${sessionId}`);

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
      case 'help': {
        result = `**📖 Kabuneko Quant Commands**

/market — Market snapshot (indices, macro, crypto)
/quote TICKER — Quick price quote
/analyze TICKER — Full quant analysis + technicals
/chart TICKER [range] — Chart data (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y)
/momentum [N] — Top N momentum leaders
/dislocate [N] — Value dislocation scanner
/backtest TICKER — RSI strategy backtest
/sentiment TICKER — News sentiment scan
/moonshot — Stealth breakout radar

Ranges: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max
Or just ask naturally — the LLM knows Kabuneko's tools. 😼`;
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
Example: {"action": "open_browser", "url": "https://google.com"}
Example: {"action": "stock_quote", "ticker": "NVDA"}
Example: {"action": "stock_analyze", "ticker": "AAPL"}
Example: {"action": "market_snapshot"}
Example: {"action": "momentum_scan", "n": "10"}
Example: {"action": "sentiment", "ticker": "TSLA"}
Example: {"action": "backtest", "ticker": "AMD"}
Example: {"action": "moonshot_scan"}
Only output a command JSON when the user explicitly asks for a system action or financial data.`;

  // If this is Kabuneko personality or user mentions stocks, enrich with market context
  let quantContext = '';
  const isFinanceQuery = /\b(stock|market|trade|crypto|bull|bear|portfolio|ticker|price|chart|analysis|momentum|rsi|backtest|earnings|sentiment)\b/i.test(userMessage);
  const isKabuneko = personalityId === 'kabuneko';

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
      content: personality.system_prompt + memorySection + quantContext + commandSection
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
            await autoExtractMemories(userMessage, fullResponse, ws);

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

// ── Auto-extract memories from user messages ──

async function autoExtractMemories(userMessage, assistantResponse, ws) {
  const lower = userMessage.toLowerCase();

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
      const result = memory.saveMemory(fact, 'user_stated', 7, 'auto');
      ws.send(JSON.stringify({
        type: 'memory_auto_saved',
        content: fact,
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
  ];

  for (const pattern of prefPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const fact = userMessage.replace(/^(hey|hi|so|well|okay|um)\s+/i, '').trim();
      memory.saveMemory(fact, 'preference', 5, 'auto');
      // Silent save — don't notify for auto-detected preferences
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
