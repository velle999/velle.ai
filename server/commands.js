import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import {
  getMarketSnapshot, formatMarketSnapshot,
  getQuote, formatQuote,
  analyzeStock, formatAnalysis,
  momentumScan, formatMomentum,
  dislocations, formatDislocations,
  backtestRSI, formatBacktest,
  getSentiment, formatSentiment,
  findMoonshots, formatMoonshots,
  generateIdeas, formatIdeas,
  getChartData,
} from './quant.js';
import { parseReminderTime, parseRepeat } from './advanced.js';

const execAsync = promisify(exec);

// ── Whitelist of allowed commands ──
// Add your own commands here. Each entry maps an action name
// to a handler function that returns { success, result }.

export const COMMAND_HANDLERS = {

  // ═══════════════════════════════════
  //  KABUNEKO QUANT COMMANDS
  // ═══════════════════════════════════

  market_snapshot: async () => {
    const snap = await getMarketSnapshot();
    return { success: true, result: formatMarketSnapshot(snap), data: snap };
  },

  stock_quote: async (params) => {
    const ticker = params.ticker?.replace(/\s/g, '').toUpperCase();
    if (!ticker) return { success: false, result: 'Need a ticker. Try {"action": "stock_quote", "ticker": "NVDA"}' };
    const q = await getQuote(ticker);
    return { success: !q.error, result: q.error ? q.error : formatQuote(q), data: q };
  },

  stock_analyze: async (params) => {
    const ticker = params.ticker?.replace(/\s/g, '').toUpperCase();
    if (!ticker) return { success: false, result: 'Need a ticker.' };
    const a = await analyzeStock(ticker);
    return { success: !a.error, result: a.error ? a.error : formatAnalysis(a), data: a };
  },

  stock_chart: async (params) => {
    const ticker = params.ticker?.replace(/\s/g, '').toUpperCase();
    const range = params.range || '6mo';
    if (!ticker) return { success: false, result: 'Need a ticker.' };
    const chart = await getChartData(ticker, range);
    return { success: !chart.error, result: chart.error ? chart.error : `Chart data loaded for ${ticker} (${range})`, data: chart };
  },

  momentum_scan: async (params) => {
    const n = parseInt(params.n) || 10;
    const picks = await momentumScan(n);
    return { success: true, result: formatMomentum(picks), data: picks };
  },

  dislocation_scan: async (params) => {
    const n = parseInt(params.n) || 10;
    const picks = await dislocations(n);
    return { success: true, result: formatDislocations(picks), data: picks };
  },

  backtest: async (params) => {
    const ticker = params.ticker?.replace(/\s/g, '').toUpperCase();
    if (!ticker) return { success: false, result: 'Need a ticker.' };
    const bt = await backtestRSI(ticker, params.buy_rsi || 30, params.sell_rsi || 70);
    return { success: !bt.error, result: bt.error ? bt.error : formatBacktest(bt), data: bt };
  },

  sentiment: async (params) => {
    const ticker = params.ticker?.replace(/\s/g, '').toUpperCase();
    if (!ticker) return { success: false, result: 'Need a ticker.' };
    const s = await getSentiment(ticker);
    return { success: true, result: formatSentiment(s), data: s };
  },

  moonshot_scan: async () => {
    const picks = await findMoonshots();
    return { success: true, result: formatMoonshots(picks), data: picks };
  },

  stock_ideas: async (params) => {
    const n = params.n || params.per_bucket || 5;
    const ideas = await generateIdeas(n);
    return { success: true, result: formatIdeas(ideas), data: ideas };
  },

  // ═══════════════════════════════════
  //  SYSTEM COMMANDS
  // ═══════════════════════════════════

  open_browser: async (params) => {
    const url = params.url || 'about:blank';
    // Sanitize URL
    if (!/^https?:\/\//i.test(url)) {
      return { success: false, result: 'Invalid URL — must start with http:// or https://' };
    }
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"`
      : `xdg-open "${url}"`;
    await execAsync(cmd);
    return { success: true, result: `Opened ${url}` };
  },

  open_app: async (params) => {
    const ALLOWED_APPS = {
      'file_manager': { win32: 'explorer', darwin: 'open -a Finder', linux: 'nautilus' },
      'terminal': { win32: 'wt', darwin: 'open -a Terminal', linux: 'gnome-terminal' },
      'powershell': { win32: 'start powershell', darwin: 'open -a Terminal', linux: 'gnome-terminal' },
      'calculator': { win32: 'calc', darwin: 'open -a Calculator', linux: 'gnome-calculator' },
      'text_editor': { win32: 'notepad', darwin: 'open -a TextEdit', linux: 'gedit' },
    };
    const appKey = (params.app || '').toLowerCase().replace(/\.exe$/, '').replace(/\s+/g, '_');
    const app = ALLOWED_APPS[appKey];
    if (!app) return { success: false, result: `Unknown app: ${params.app}. Available: ${Object.keys(ALLOWED_APPS).join(', ')}` };
    const cmd = app[process.platform] || app.linux;
    await execAsync(cmd);
    return { success: true, result: `Opened ${params.app}` };
  },

  play_music: async (params) => {
    const query = encodeURIComponent(params.query || 'lofi');
    const url = `https://www.youtube.com/results?search_query=${query}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"`
      : `xdg-open "${url}"`;
    await execAsync(cmd);
    return { success: true, result: `Searching YouTube for: ${params.query}` };
  },

  set_reminder: async (params) => {
    const text = params.text || params.message || params.content || params.reminder || 'Reminder';
    const timeStr = params.time || params.due_at || params.when || 'in 5 minutes';

    // If a real reminder engine is injected, use it
    const engine = COMMAND_HANDLERS._reminderEngine;
    if (engine) {
      const dueAt = parseReminderTime(timeStr) || parseReminderTime(`in ${timeStr}`);
      if (dueAt) {
        const repeat = parseRepeat(timeStr);
        const rem = engine.add(text, dueAt, repeat);
        return { success: true, result: `⏰ Reminder set: "${rem.content}" — ${rem.due_at}${rem.repeat ? ` (${rem.repeat})` : ''}` };
      }
    }

    return { success: true, result: `⏰ Reminder set: "${text}" at ${timeStr}` };
  },

  system_info: async () => {
    return {
      success: true,
      result: JSON.stringify({
        platform: process.platform,
        hostname: os.hostname(),
        uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
        memory: `${Math.round(os.freemem() / 1e9)}GB free / ${Math.round(os.totalmem() / 1e9)}GB total`,
        cpus: os.cpus().length + ' cores'
      }, null, 2)
    };
  },

  run_shell: async (params) => {
    const isWin = process.platform === 'win32';
    // Blocked patterns — never allow these regardless
    const BLOCKED = [/rm\s+-rf/i, /del\s+\/[sfq]/i, /format\s+/i, /shutdown/i, /restart/i, /reg\s+delete/i, /Remove-Item.*-Recurse/i, /Stop-Process/i, /kill/i, /mkfs/i, /dd\s+if/i, /:\(\)\{/];

    const cmd = params.command?.trim()
      ?.replace(/\s*\/think\b.*$/gi, '')   // Strip qwen3 /think tags
      ?.replace(/<think>[\s\S]*?<\/think>/gi, '')  // Strip <think> blocks
      ?.replace(/\s*\/no_think\b/gi, '')
      ?.trim();
    if (!cmd) return { success: false, result: 'No command provided.' };
    if (cmd.length > 200) return { success: false, result: 'Command too long (200 char max).' };
    if (BLOCKED.some(p => p.test(cmd))) return { success: false, result: 'That command is blocked for safety.' };

    try {
      const shell = isWin ? 'powershell.exe' : '/bin/sh';
      const args = isWin ? ['-NoProfile', '-NonInteractive', '-Command', cmd] : ['-c', cmd];
      const { stdout, stderr } = await execAsync(`${shell} ${args.map(a => `"${a}"`).join(' ')}`, { timeout: 15000 });
      const output = (stdout || stderr || '').trim();
      return { success: true, result: output || '(no output)' };
    } catch (err) {
      const output = (err.stdout || err.stderr || err.message || '').trim();
      return { success: false, result: `Error: ${output}` };
    }
  },

  // ═══════════════════════════════════
  //  PRODUCTIVITY COMMANDS (LLM-triggered)
  // ═══════════════════════════════════

  add_todo: async (params) => {
    const mgr = COMMAND_HANDLERS._todoManager;
    if (!mgr) return { success: false, result: 'Todo system not initialized' };
    const t = mgr.add(
      params.content || params.text || params.task,
      params.project || 'inbox',
      params.priority || 2,
      params.due_date || params.due || null,
      params.tags || null
    );
    return { success: true, result: `✅ Task added: #${t.id} ${t.content}` };
  },

  complete_todo: async (params) => {
    const mgr = COMMAND_HANDLERS._todoManager;
    if (!mgr) return { success: false, result: 'Todo system not initialized' };
    const id = params.id || params.task_id;
    const t = mgr.complete(id);
    return { success: true, result: t ? `✅ Completed: #${t.id} ${t.content}` : '⚠ Task not found' };
  },

  add_habit: async (params) => {
    const mgr = COMMAND_HANDLERS._habitTracker;
    if (!mgr) return { success: false, result: 'Habit system not initialized' };
    const h = mgr.addHabit(params.name || params.habit, params.icon || '✅');
    return { success: true, result: `🔄 Habit created: ${h.name}` };
  },

  check_habit: async (params) => {
    const mgr = COMMAND_HANDLERS._habitTracker;
    if (!mgr) return { success: false, result: 'Habit system not initialized' };
    const r = mgr.checkIn(params.id || params.habit_id);
    return { success: true, result: r.checked ? `✅ Checked in!` : '⚠ Already checked today' };
  },

  add_goal: async (params) => {
    const mgr = COMMAND_HANDLERS._goalTracker;
    if (!mgr) return { success: false, result: 'Goal system not initialized' };
    const g = mgr.addGoal(params.title || params.goal, params.description);
    return { success: true, result: `🎯 Goal set: #${g.id} ${g.title}` };
  },

  save_bookmark: async (params) => {
    const mgr = COMMAND_HANDLERS._bookmarks;
    if (!mgr) return { success: false, result: 'Bookmark system not initialized' };
    const b = mgr.save(params.content || params.text, params.note, params.tags);
    return { success: true, result: `🔖 Bookmarked: #${b.id}` };
  },

  save_knowledge: async (params) => {
    const mgr = COMMAND_HANDLERS._knowledgeBase;
    if (!mgr) return { success: false, result: 'KB not initialized' };
    const item = mgr.add(params.title, params.content, params.type || 'note', params.language, params.tags);
    return { success: true, result: `📚 Saved: #${item.id} ${item.title}` };
  },
};

export class CommandExecutor {
  constructor(memoryManager) {
    this.memory = memoryManager;
    this.handlers = { ...COMMAND_HANDLERS };
  }

  getAvailableCommands() {
    return Object.keys(this.handlers);
  }

  async execute(action, params = {}) {
    const handler = this.handlers[action];
    if (!handler) {
      return {
        success: false,
        result: `Unknown command: ${action}. Available: ${this.getAvailableCommands().join(', ')}`
      };
    }

    try {
      const result = await handler(params);
      this.memory?.logCommand(action, params, result.success ? 'completed' : 'failed', result.result);
      return result;
    } catch (err) {
      const errorResult = { success: false, result: `Error: ${err.message}` };
      this.memory?.logCommand(action, params, 'error', err.message);
      return errorResult;
    }
  }

  // Parse LLM output for command intents
  // The LLM should output JSON blocks like: {"action": "open_browser", "url": "..."}
  extractCommands(text) {
    const commands = [];
    const jsonPattern = /\{[^{}]*"action"\s*:\s*"[^"]+?"[^{}]*\}/g;
    const matches = text.match(jsonPattern);
    if (matches) {
      for (const match of matches) {
        try {
          const parsed = JSON.parse(match);
          if (parsed.action) {
            commands.push(parsed);
          }
        } catch { /* skip malformed JSON */ }
      }
    }
    return commands;
  }
}
