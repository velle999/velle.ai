import { exec } from 'child_process';
import { promisify } from 'util';
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
} from './quant.js';

const execAsync = promisify(exec);

// ── Whitelist of allowed commands ──
// Add your own commands here. Each entry maps an action name
// to a handler function that returns { success, result }.

const COMMAND_HANDLERS = {

  // ═══════════════════════════════════
  //  KABUNEKO QUANT COMMANDS
  // ═══════════════════════════════════

  market_snapshot: async () => {
    const snap = await getMarketSnapshot();
    return { success: true, result: formatMarketSnapshot(snap), data: snap };
  },

  stock_quote: async (params) => {
    const ticker = params.ticker?.toUpperCase();
    if (!ticker) return { success: false, result: 'Need a ticker. Try {"action": "stock_quote", "ticker": "NVDA"}' };
    const q = await getQuote(ticker);
    return { success: !q.error, result: q.error ? q.error : formatQuote(q), data: q };
  },

  stock_analyze: async (params) => {
    const ticker = params.ticker?.toUpperCase();
    if (!ticker) return { success: false, result: 'Need a ticker.' };
    const a = await analyzeStock(ticker);
    return { success: !a.error, result: a.error ? a.error : formatAnalysis(a), data: a };
  },

  stock_chart: async (params) => {
    const ticker = params.ticker?.toUpperCase();
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
    const ticker = params.ticker?.toUpperCase();
    if (!ticker) return { success: false, result: 'Need a ticker.' };
    const bt = await backtestRSI(ticker, params.buy_rsi || 30, params.sell_rsi || 70);
    return { success: !bt.error, result: bt.error ? bt.error : formatBacktest(bt), data: bt };
  },

  sentiment: async (params) => {
    const ticker = params.ticker?.toUpperCase();
    if (!ticker) return { success: false, result: 'Need a ticker.' };
    const s = await getSentiment(ticker);
    return { success: true, result: formatSentiment(s), data: s };
  },

  moonshot_scan: async () => {
    const picks = await findMoonshots();
    return { success: true, result: formatMoonshots(picks), data: picks };
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
    // Store reminder — in MVP, just log it. Upgrade to system notifications later.
    return { 
      success: true, 
      result: `Reminder set: "${params.text}" at ${params.time || 'unspecified time'}`,
      data: { text: params.text, time: params.time }
    };
  },

  system_info: async () => {
    const os = await import('os');
    return {
      success: true,
      result: JSON.stringify({
        platform: process.platform,
        hostname: os.default.hostname(),
        uptime: `${Math.floor(os.default.uptime() / 3600)}h ${Math.floor((os.default.uptime() % 3600) / 60)}m`,
        memory: `${Math.round(os.default.freemem() / 1e9)}GB free / ${Math.round(os.default.totalmem() / 1e9)}GB total`,
        cpus: os.default.cpus().length + ' cores'
      }, null, 2)
    };
  },

  run_shell: async (params) => {
    // Platform-aware safe commands
    const isWin = process.platform === 'win32';
    const SAFE_COMMANDS = isWin
      ? ['date /t', 'time /t', 'whoami', 'cd', 'hostname', 'systeminfo', 'tasklist', 'ver', 'vol', 'dir', 'powershell', 'powershell.exe', 'start powershell']
      : ['date', 'whoami', 'pwd', 'uptime', 'df -h', 'free -h', 'hostname', 'uname -a'];

    const cmd = params.command?.trim();
    if (!SAFE_COMMANDS.includes(cmd)) {
      return { success: false, result: `Command not in safe list. Allowed: ${SAFE_COMMANDS.join(', ')}` };
    }
    const { stdout } = await execAsync(cmd, { shell: isWin ? 'cmd.exe' : '/bin/sh' });
    return { success: true, result: stdout.trim() };
  }
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
