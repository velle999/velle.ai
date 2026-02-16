// ═══════════════════════════════════════════════════════════════
//  KABUNEKO QUANT ENGINE — Node.js port of the Discord bot brain
//  Provides: market data, quant stats, momentum, dislocations,
//  backtesting, sentiment, charts, moonshot radar
// ═══════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──

const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
const FINVIZ_URL = 'https://finviz.com/quote.ashx';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const WATCHLIST = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO','AMD','INTC',
  'PLTR','RKLB','HIMS','SOFI','HOOD','COIN','MSTR','APP','SMCI','CRWD',
  'CRM','ORCL','NFLX','DIS','PYPL','SQ','UBER','SHOP','SNOW','NET',
  'DDOG','MDB','OKLO','CELH','OSCR','NBIS','RBRK','ABCL','OXY','ASTS',
  'JPM','GS','BAC','V','MA','BRK.B','WMT','COST','HD','NKE',
  'XOM','CVX','GLD','SLV','SCHD','SPY','QQQ','TEM','BIIB',
];

const EMOJI_BANK = ['🚀','📈','📉','💸','🦍','💎','🔥','🧠','🤡','🤑','📊','🔮','👀','💀','⚡','🐻','🐂','🤖'];

// ── Yahoo Finance API ──

async function yahooQuoteBatch(symbols) {
  if (typeof symbols === 'string') symbols = [symbols];
  const out = {};
  for (const s of symbols) out[s] = { price: null, pct: null, prev: null, change: null, state: null };

  try {
    const url = `${YAHOO_QUOTE_URL}?symbols=${symbols.join(',')}&lang=en-US&region=US`;
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    const data = await resp.json();
    for (const item of (data?.quoteResponse?.result || [])) {
      const s = item.symbol;
      if (out[s]) {
        out[s].price = item.regularMarketPrice ?? null;
        out[s].pct = item.regularMarketChangePercent ?? null;
        out[s].prev = item.regularMarketPreviousClose ?? null;
        out[s].change = item.regularMarketChange ?? null;
        out[s].state = item.marketState ?? null;
        out[s].name = item.shortName ?? item.longName ?? s;
        out[s].volume = item.regularMarketVolume ?? null;
        out[s].marketCap = item.marketCap ?? null;
        out[s].fiftyTwoWeekHigh = item.fiftyTwoWeekHigh ?? null;
        out[s].fiftyTwoWeekLow = item.fiftyTwoWeekLow ?? null;
        out[s].forwardPE = item.forwardPE ?? null;
        out[s].trailingPE = item.trailingPE ?? null;
        out[s].dividendYield = item.dividendYield ?? null;
        out[s].epsTrailingTwelveMonths = item.epsTrailingTwelveMonths ?? null;
      }
    }
  } catch (e) {
    console.error('[Yahoo Quote Error]', e.message);
  }
  return out;
}

async function yahooChart(symbol, range = '6mo', interval = '1d') {
  try {
    const url = `${YAHOO_CHART_URL}/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const ohlcv = result.indicators?.quote?.[0] || {};
    const rows = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = ohlcv.open?.[i], h = ohlcv.high?.[i], l = ohlcv.low?.[i], c = ohlcv.close?.[i], v = ohlcv.volume?.[i];
      if (c != null) {
        rows.push({
          date: new Date(timestamps[i] * 1000),
          open: o, high: h, low: l, close: c, volume: v || 0
        });
      }
    }
    return rows;
  } catch (e) {
    console.error(`[Yahoo Chart Error] ${symbol}:`, e.message);
    return null;
  }
}

// ── Technical Indicators ──

function calcSMA(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result[i] = sum / period;
  }
  return result;
}

function calcEMA(data, period) {
  const result = new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

function calcRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return rsi;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }
  avgGain /= period;
  avgLoss /= period;

  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function calcATR(highs, lows, closes, period = 14) {
  const tr = [0];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  return calcSMA(tr, period);
}

function calcADX(highs, lows, closes, period = 14) {
  if (closes.length < period * 2) return new Array(closes.length).fill(null);
  // Simplified ADX
  const plusDM = [0], minusDM = [0], tr = [0];
  for (let i = 1; i < closes.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smoothTR = calcEMA(tr, period);
  const smoothPlusDM = calcEMA(plusDM, period);
  const smoothMinusDM = calcEMA(minusDM, period);

  const dx = [];
  for (let i = 0; i < closes.length; i++) {
    if (!smoothTR[i] || smoothTR[i] === 0) { dx.push(0); continue; }
    const plusDI = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const minusDI = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const sum = plusDI + minusDI;
    dx.push(sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100);
  }
  return calcEMA(dx, period);
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const validMACD = macdLine.filter(v => v != null);
  const signalLine = calcEMA(validMACD, signal);
  // Pad signal line
  const padded = new Array(macdLine.length - validMACD.length).fill(null).concat(signalLine);
  const histogram = macdLine.map((v, i) => v != null && padded[i] != null ? v - padded[i] : null);
  return { macd: macdLine, signal: padded, histogram };
}

function calcBollingerBands(closes, period = 20, stdDev = 2) {
  const sma = calcSMA(closes, period);
  const upper = [], lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (sma[i] == null) { upper.push(null); lower.push(null); continue; }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (closes[j] - sma[i]) ** 2;
    const std = Math.sqrt(sumSq / period);
    upper.push(sma[i] + stdDev * std);
    lower.push(sma[i] - stdDev * std);
  }
  return { upper, middle: sma, lower };
}

// ── Quant Stats (mirrors Python quant_stats) ──

function quantStats(rows) {
  if (!rows || rows.length < 2) {
    return { total_return: null, annual_return: null, annual_vol: null, sharpe: null, max_drawdown: null };
  }
  const closes = rows.map(r => r.close);
  const dailyReturns = [];
  for (let i = 1; i < closes.length; i++) {
    dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }

  const nDays = (rows[rows.length - 1].date - rows[0].date) / (1000 * 60 * 60 * 24);
  const nYears = nDays / 365.25;
  const totalReturn = closes[closes.length - 1] / closes[0] - 1;
  const annualReturn = nYears > 0 ? Math.pow(1 + totalReturn, 1 / nYears) - 1 : null;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyReturns.length;
  const annualVol = Math.sqrt(variance) * Math.sqrt(252);
  const sharpe = annualVol !== 0 ? annualReturn / annualVol : null;

  let maxDD = 0, peak = closes[0];
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  return {
    total_return: totalReturn,
    annual_return: annualReturn,
    annual_vol: annualVol,
    sharpe: sharpe,
    max_drawdown: maxDD,
    data_points: rows.length,
    period_days: Math.round(nDays),
  };
}

// ── Market Snapshot ──

async function getMarketSnapshot() {
  const indexSyms = ['^GSPC', '^NDX', '^DJI'];
  const futureSyms = ['ES=F', 'NQ=F', 'YM=F'];
  const macroSyms = ['CL=F', 'GC=F', '^TNX', 'DX-Y.NYB'];
  const cryptoSyms = ['BTC-USD', 'ETH-USD', 'SOL-USD'];

  const allSyms = [...indexSyms, ...futureSyms, ...macroSyms, ...cryptoSyms];
  const quotes = await yahooQuoteBatch(allSyms);

  const marketState = quotes['^GSPC']?.state || 'CLOSED';
  const isCashSession = marketState === 'REGULAR';

  const fmt = (sym) => {
    const q = quotes[sym];
    if (!q || q.pct == null) return null;
    return { symbol: sym, price: q.price, pct: +q.pct.toFixed(2), name: q.name };
  };

  const indices = isCashSession
    ? indexSyms.map(fmt).filter(Boolean)
    : futureSyms.map(fmt).filter(Boolean);

  const macro = macroSyms.map(fmt).filter(Boolean);
  const crypto = cryptoSyms.map(fmt).filter(Boolean);

  // Mood
  const idxMoves = indices.map(i => i.pct).filter(v => v != null);
  const avgMove = idxMoves.length ? idxMoves.reduce((a, b) => a + b, 0) / idxMoves.length : 0;
  let mood;
  if (avgMove >= 0.6) mood = 'solidly higher 📈';
  else if (avgMove >= 0.2) mood = 'slightly higher';
  else if (avgMove > -0.2) mood = 'little changed 😐';
  else if (avgMove > -0.6) mood = 'slightly lower';
  else mood = 'under pressure 📉';

  return {
    timestamp: new Date().toISOString(),
    market_state: marketState,
    is_cash_session: isCashSession,
    mood,
    indices,
    macro,
    crypto,
  };
}

function formatMarketSnapshot(snap) {
  let text = `📊 **Market Snapshot** — ${new Date(snap.timestamp).toLocaleString()}\n`;
  text += `State: ${snap.market_state} | Mood: ${snap.mood}\n\n`;

  text += `**${snap.is_cash_session ? 'Indices' : 'Futures'}:**\n`;
  for (const i of snap.indices) {
    const arrow = i.pct >= 0 ? '🟢' : '🔴';
    text += `${arrow} ${i.name || i.symbol}: ${i.pct >= 0 ? '+' : ''}${i.pct}%\n`;
  }

  if (snap.macro.length) {
    text += `\n**Macro:**\n`;
    for (const m of snap.macro) {
      text += `• ${m.name || m.symbol}: $${m.price?.toLocaleString() ?? 'n/a'} (${m.pct >= 0 ? '+' : ''}${m.pct}%)\n`;
    }
  }

  if (snap.crypto.length) {
    text += `\n**Crypto:**\n`;
    for (const c of snap.crypto) {
      text += `• ${c.name || c.symbol}: $${c.price?.toLocaleString() ?? 'n/a'} (${c.pct >= 0 ? '+' : ''}${c.pct}%)\n`;
    }
  }

  text += '\n_Not investment advice; data may be delayed._';
  return text;
}

// ── Stock Quote ──

async function getQuote(ticker) {
  ticker = ticker.toUpperCase();
  const q = (await yahooQuoteBatch(ticker))[ticker];
  if (!q || q.price == null) return { error: `No data for ${ticker}` };
  return {
    ticker,
    name: q.name,
    price: q.price,
    change_pct: q.pct != null ? +q.pct.toFixed(2) : null,
    prev_close: q.prev,
    volume: q.volume,
    market_cap: q.marketCap,
    pe: q.forwardPE || q.trailingPE,
    high_52w: q.fiftyTwoWeekHigh,
    low_52w: q.fiftyTwoWeekLow,
    eps: q.epsTrailingTwelveMonths,
    dividend_yield: q.dividendYield,
    state: q.state,
  };
}

function formatQuote(q) {
  if (q.error) return `⚠ ${q.error}`;
  const arrow = (q.change_pct ?? 0) >= 0 ? '🟢' : '🔴';
  let text = `${arrow} **${q.name}** (${q.ticker})\n`;
  text += `Price: $${q.price.toFixed(2)} (${q.change_pct >= 0 ? '+' : ''}${q.change_pct}%)\n`;
  if (q.market_cap) text += `Market Cap: $${(q.market_cap / 1e9).toFixed(1)}B\n`;
  if (q.pe) text += `P/E: ${q.pe.toFixed(1)}\n`;
  if (q.volume) text += `Volume: ${q.volume.toLocaleString()}\n`;
  if (q.high_52w) text += `52w Range: $${q.low_52w?.toFixed(2)} — $${q.high_52w?.toFixed(2)}\n`;

  // Kabuneko snark
  if (q.change_pct > 3) text += "\nKabuneko says: Bulls are having fun! 🚀";
  else if (q.change_pct < -3) text += "\nKabuneko says: Bears are out for blood. 💀";
  else text += "\nKabuneko says: Market mood is meh. 😐";

  return text;
}

// ── Full Quant Analysis ──

async function analyzeStock(ticker) {
  ticker = ticker.toUpperCase();
  const rows = await yahooChart(ticker, '2y', '1d');
  if (!rows || rows.length < 50) return { error: `Not enough data for ${ticker}` };

  const closes = rows.map(r => r.close);
  const highs = rows.map(r => r.high);
  const lows = rows.map(r => r.low);
  const volumes = rows.map(r => r.volume);

  const stats = quantStats(rows);
  const rsi = calcRSI(closes);
  const sma50 = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);
  const adx = calcADX(highs, lows, closes);
  const atr = calcATR(highs, lows, closes);
  const macd = calcMACD(closes);
  const bb = calcBollingerBands(closes);

  const latestRSI = rsi.filter(v => v != null).pop();
  const latestADX = adx.filter(v => v != null).pop();
  const latestATR = atr.filter(v => v != null).pop();
  const latestMACD = macd.macd.filter(v => v != null).pop();
  const latestSignal = macd.signal.filter(v => v != null).pop();
  const latestPrice = closes[closes.length - 1];
  const latestBBUpper = bb.upper.filter(v => v != null).pop();
  const latestBBLower = bb.lower.filter(v => v != null).pop();

  // Volume analysis
  const vol20 = volumes.slice(-20);
  const avgVol = vol20.reduce((a, b) => a + b, 0) / vol20.length;
  const volRatio = avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 0;

  // Pattern detection
  const patterns = [];
  const len = closes.length;
  if (sma50[len - 2] < sma200[len - 2] && sma50[len - 1] > sma200[len - 1]) {
    patterns.push('🟢 Golden Cross: MA50 crossed above MA200');
  }
  if (sma50[len - 2] > sma200[len - 2] && sma50[len - 1] < sma200[len - 1]) {
    patterns.push('🔴 Death Cross: MA50 crossed below MA200');
  }
  if (latestRSI > 70) patterns.push(`⚠️ RSI ${latestRSI.toFixed(1)} — Overbought`);
  if (latestRSI < 30) patterns.push(`🧊 RSI ${latestRSI.toFixed(1)} — Oversold`);
  if (latestPrice >= latestBBUpper) patterns.push('📈 Price at upper Bollinger Band');
  if (latestPrice <= latestBBLower) patterns.push('📉 Price at lower Bollinger Band');
  if (latestMACD > latestSignal && macd.macd[len - 2] < macd.signal[len - 2]) {
    patterns.push('🟢 MACD bullish crossover');
  }
  if (latestMACD < latestSignal && macd.macd[len - 2] > macd.signal[len - 2]) {
    patterns.push('🔴 MACD bearish crossover');
  }

  // 20-day high/low
  const recent20 = closes.slice(-20);
  if (latestPrice >= Math.max(...recent20)) patterns.push('🚀 20-day High — momentum chasers circling');
  if (latestPrice <= Math.min(...recent20)) patterns.push('📉 20-day Low — sadness unlocked');

  // Kabuneko verdict
  let verdict;
  if (stats.sharpe > 1.2 && stats.max_drawdown > -0.3) verdict = '🟢 BUY (if you believe in backtests—lol)';
  else if (stats.sharpe < 0.3 && stats.max_drawdown < -0.4) verdict = '🔴 SELL (unless you enjoy pain)';
  else verdict = '🟡 HOLD (could be worse)';

  return {
    ticker,
    stats,
    technicals: {
      rsi: latestRSI,
      adx: latestADX,
      atr: latestATR,
      macd: latestMACD,
      macd_signal: latestSignal,
      sma50: sma50[len - 1],
      sma200: sma200[len - 1],
      bb_upper: latestBBUpper,
      bb_lower: latestBBLower,
      vol_ratio: +volRatio.toFixed(2),
    },
    patterns,
    verdict,
    data: rows,
  };
}

function formatAnalysis(a) {
  if (a.error) return `⚠ ${a.error}`;
  const s = a.stats;
  let text = `📊 **Kabuneko's Brutally Honest Quant Report: ${a.ticker}**\n\n`;

  text += `📈 Total Return: ${(s.total_return * 100).toFixed(2)}%\n`;
  text += `📆 Annual Return: ${(s.annual_return * 100).toFixed(2)}%\n`;
  text += `🎢 Annual Volatility: ${(s.annual_vol * 100).toFixed(2)}%\n`;
  text += `⚖️ Sharpe Ratio: ${s.sharpe?.toFixed(2) ?? 'n/a'}\n`;
  text += `🪂 Max Drawdown: ${(s.max_drawdown * 100).toFixed(2)}%\n`;
  text += `📅 Data: ${s.data_points} bars over ${s.period_days} days\n\n`;

  const t = a.technicals;
  text += `**Technicals:**\n`;
  text += `RSI(14): ${t.rsi?.toFixed(1) ?? 'n/a'} | ADX: ${t.adx?.toFixed(1) ?? 'n/a'} | ATR: ${t.atr?.toFixed(2) ?? 'n/a'}\n`;
  text += `MACD: ${t.macd?.toFixed(3) ?? 'n/a'} / Signal: ${t.macd_signal?.toFixed(3) ?? 'n/a'}\n`;
  text += `SMA50: ${t.sma50?.toFixed(2) ?? 'n/a'} | SMA200: ${t.sma200?.toFixed(2) ?? 'n/a'}\n`;
  text += `BB: ${t.bb_lower?.toFixed(2)} — ${t.bb_upper?.toFixed(2)} | Vol Ratio: ${t.vol_ratio}×\n\n`;

  if (a.patterns.length) {
    text += `**Patterns:**\n${a.patterns.join('\n')}\n\n`;
  }

  text += `**Verdict:** ${a.verdict}\n`;
  text += '_Not financial advice. Kabuneko is judging you silently. 😼_';
  return text;
}

// ── Momentum Scanner ──

async function momentumScan(n = 10) {
  const results = [];
  // Batch quote for all watchlist
  const quotes = await yahooQuoteBatch(WATCHLIST);

  for (const sym of WATCHLIST) {
    try {
      const rows = await yahooChart(sym, '1y', '1d');
      if (!rows || rows.length < 60) continue;

      const closes = rows.map(r => r.close);
      const volumes = rows.map(r => r.volume);
      const price = closes[closes.length - 1];

      if (price < 5) continue;

      // Returns at different timeframes
      const ret = (days) => {
        if (closes.length <= days) return null;
        const old = closes[closes.length - 1 - days];
        return old > 0 ? (price / old - 1) : null;
      };

      const r1m = ret(21), r3m = ret(63), r6m = ret(126), r12m = ret(252);

      // Volume z-score
      const vol20 = volumes.slice(-20);
      const volMean = vol20.reduce((a, b) => a + b, 0) / vol20.length;
      const volStd = Math.sqrt(vol20.reduce((a, b) => a + (b - volMean) ** 2, 0) / vol20.length);
      const volZ = volStd > 0 ? (volumes[volumes.length - 1] - volMean) / volStd : 0;

      const rsi = calcRSI(closes);
      const latestRSI = rsi.filter(v => v != null).pop() || 50;
      const adx = calcADX(rows.map(r => r.high), rows.map(r => r.low), closes);
      const latestADX = adx.filter(v => v != null).pop() || 0;

      // 52w proximity
      const high52w = Math.max(...closes.slice(-252));
      const prox52w = high52w > 0 ? price / high52w : 0;

      // Composite score (weighted multi-TF momentum)
      const parts = [];
      const weights = [];
      if (r12m != null) { parts.push(r12m); weights.push(0.4); }
      if (r6m != null) { parts.push(r6m); weights.push(0.3); }
      if (r3m != null) { parts.push(r3m); weights.push(0.2); }
      if (r1m != null) { parts.push(r1m); weights.push(0.1); }

      if (!parts.length) continue;

      const totalW = weights.reduce((a, b) => a + b, 0);
      let score = parts.reduce((sum, v, i) => sum + v * weights[i], 0) / totalW;

      // Bonuses
      score += Math.max(0, Math.min(3, volZ)) * 0.15; // volume boost
      score += (prox52w - 0.95) * 2.0; // near 52w high
      if (latestADX >= 20) score += 0.05; // trend strength
      if (latestRSI > 80 || latestRSI < 20) score -= 0.05; // extreme RSI penalty

      results.push({
        ticker: sym,
        price,
        score,
        r1m, r3m, r6m, r12m,
        rsi: latestRSI,
        adx: latestADX,
        vol_z: +volZ.toFixed(1),
        prox_52w: +(prox52w * 100).toFixed(1),
        name: quotes[sym]?.name || sym,
      });
    } catch { continue; }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, n);
}

function formatMomentum(picks) {
  if (!picks.length) return 'Momentum detector found nothing. Market\'s napping. ☕📉';

  const pct = (v) => v != null ? `${(v * 100).toFixed(1)}%` : '—';

  let text = '🚀 **Kabuneko Momentum Leaders:**\n\n';
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    text += `\`${i + 1}.\` **${p.ticker}** $${p.price.toFixed(2)} `;
    text += `[1m ${pct(p.r1m)} | 3m ${pct(p.r3m)} | 6m ${pct(p.r6m)} | 12m ${pct(p.r12m)}] `;
    text += `• 52w ${p.prox_52w}% • vol-z ${p.vol_z} • RSI ${p.rsi.toFixed(0)} • ADX ${p.adx.toFixed(0)}\n`;
  }
  text += '\nKabuneko says: trend > story. Trail stops. Don\'t marry tickers. 😼';
  return text;
}

// ── Dislocation Detector ──

async function dislocations(n = 10) {
  const results = [];
  const quotes = await yahooQuoteBatch(WATCHLIST);

  for (const sym of WATCHLIST) {
    const q = quotes[sym];
    if (!q || !q.price) continue;

    const pe = q.forwardPE || q.trailingPE;
    const mc = q.marketCap;

    // Filter: need PE, reasonable market cap
    if (!pe || pe <= 0 || pe < 2 || pe > 80) continue;
    if (!mc || mc <= 0 || mc > 5e11) continue;

    // Simple value score — lower PE = higher value
    const valueScore = 1.0 / pe;

    results.push({
      ticker: sym,
      name: q.name || sym,
      score: valueScore,
      pe: +pe.toFixed(1),
      market_cap: +(mc / 1e9).toFixed(1),
      price: q.price,
      change_pct: q.pct != null ? +q.pct.toFixed(2) : null,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, n);
}

function formatDislocations(picks) {
  if (!picks.length) return 'No obvious dislocations. Efficient market? Efficiently dumb? 🤷‍♂️';

  let text = '🔍 **Kabuneko Dislocation Detector:**\n\n';
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    text += `\`${i + 1}.\` **${p.ticker}** (${p.name}) — PE ${p.pe} | MC $${p.market_cap}B | $${p.price.toFixed(2)}\n`;
  }
  text += '\nTranslation: cheap *for a reason* vs. *actually mispriced*. Your move. 😼';
  return text;
}

// ── RSI Backtest ──

async function backtestRSI(ticker, buyThreshold = 30, sellThreshold = 70) {
  ticker = ticker.toUpperCase();
  const rows = await yahooChart(ticker, '5y', '1d');
  if (!rows || rows.length < 50) return { error: `Not enough data for ${ticker} backtest` };

  const closes = rows.map(r => r.close);
  const rsi = calcRSI(closes);

  let position = 0, cash = 1.0, trades = 0;
  const tradeLog = [];

  for (let i = 1; i < closes.length; i++) {
    if (rsi[i] == null) continue;
    if (rsi[i] < buyThreshold && position === 0) {
      position = cash / closes[i];
      cash = 0;
      trades++;
      tradeLog.push({ type: 'BUY', price: closes[i], date: rows[i].date, rsi: rsi[i] });
    } else if (rsi[i] > sellThreshold && position > 0) {
      cash = position * closes[i];
      position = 0;
      trades++;
      tradeLog.push({ type: 'SELL', price: closes[i], date: rows[i].date, rsi: rsi[i] });
    }
  }
  if (position > 0) {
    cash = position * closes[closes.length - 1];
    position = 0;
  }

  const totalReturn = cash - 1.0;
  const buyHold = (closes[closes.length - 1] / closes[0]) - 1;
  const latestRSI = rsi.filter(v => v != null).pop();

  return {
    ticker,
    total_return: totalReturn,
    buy_hold_return: buyHold,
    trades,
    latest_rsi: latestRSI,
    start_date: rows[0].date,
    end_date: rows[rows.length - 1].date,
    last_trades: tradeLog.slice(-6),
  };
}

function formatBacktest(bt) {
  if (bt.error) return `⚠ ${bt.error}`;
  const snark = bt.total_return > bt.buy_hold_return
    ? 'RSI strategy beat buy & hold. Even a blind cat finds a mouse sometimes. 😼'
    : 'Buy & hold won. RSI strategy lost to doing literally nothing. Classic. 💀';

  let text = `📊 **RSI Backtest: ${bt.ticker}** (RSI<${30} buy, RSI>${70} sell)\n\n`;
  text += `Strategy Return: ${(bt.total_return * 100).toFixed(2)}%\n`;
  text += `Buy & Hold Return: ${(bt.buy_hold_return * 100).toFixed(2)}%\n`;
  text += `Trades: ${bt.trades}\n`;
  text += `Current RSI(14): ${bt.latest_rsi?.toFixed(1) ?? 'n/a'}\n`;
  text += `Period: ${bt.start_date.toLocaleDateString()} — ${bt.end_date.toLocaleDateString()}\n\n`;

  if (bt.last_trades.length) {
    text += '**Recent Signals:**\n';
    for (const t of bt.last_trades) {
      text += `${t.type === 'BUY' ? '🟢' : '🔴'} ${t.type} @ $${t.price.toFixed(2)} (RSI ${t.rsi.toFixed(1)}) — ${t.date.toLocaleDateString()}\n`;
    }
  }

  text += `\n${snark}`;
  return text;
}

// ── News & Sentiment ──

async function getTickerNews(ticker) {
  ticker = ticker.toUpperCase();
  try {
    const url = `${FINVIZ_URL}?t=${ticker}`;
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    const html = await resp.text();

    // Parse headlines from Finviz
    const headlines = [];
    const matches = html.matchAll(/<a[^>]+class="tab-link-news"[^>]*>([^<]+)<\/a>/g);
    for (const m of matches) {
      headlines.push(m[1].trim());
      if (headlines.length >= 10) break;
    }

    // Fallback: broader pattern
    if (headlines.length === 0) {
      const fallback = html.matchAll(/news-link-left[^"]*"[^>]*>([^<]+)<\/a>/g);
      for (const m of fallback) {
        headlines.push(m[1].trim());
        if (headlines.length >= 10) break;
      }
    }

    // Even broader fallback
    if (headlines.length === 0) {
      const tableMatch = html.match(/fullview-news-outer[\s\S]*?<\/table>/);
      if (tableMatch) {
        const linkMatches = tableMatch[0].matchAll(/<a[^>]*>([^<]{15,})<\/a>/g);
        for (const m of linkMatches) {
          headlines.push(m[1].trim());
          if (headlines.length >= 10) break;
        }
      }
    }

    return headlines;
  } catch (e) {
    console.error(`[News Error] ${ticker}:`, e.message);
    return [];
  }
}

function analyzeSentiment(headlines) {
  const posWords = ['beat','surge','rally','win','profit','outperform','soars','growth','record','raise','strong','bull','gain','jump','rise','boost','climb','beats','outlook','upgrade'];
  const negWords = ['miss','drop','loss','plunge','warn','weak','lawsuit','down','cut','investigation','probe','sell','bear','falls','crash','tumble','slump','dip','slide','disappoint','downgrade'];

  let score = 0;
  for (const h of headlines) {
    const hl = h.toLowerCase();
    for (const w of posWords) if (hl.includes(w)) score++;
    for (const w of negWords) if (hl.includes(w)) score--;
  }
  return score;
}

async function getSentiment(ticker) {
  const headlines = await getTickerNews(ticker);
  if (!headlines.length) return { ticker, headlines: [], score: 0, mood: 'No data' };

  const score = analyzeSentiment(headlines);
  let mood;
  if (score > 2) mood = '🔥 Very positive — bulls throwing confetti';
  else if (score > 0) mood = '🙂 Slightly positive — cautious optimism';
  else if (score === 0) mood = '😐 Neutral — Kabuneko yawns';
  else if (score > -2) mood = '🙁 Slightly negative — bears sniffing around';
  else mood = '💀 Very negative — hide your portfolio';

  return { ticker: ticker.toUpperCase(), headlines: headlines.slice(0, 5), score, mood };
}

function formatSentiment(s) {
  let text = `**Sentiment: ${s.ticker}** — ${s.mood} (score: ${s.score})\n\n`;
  if (s.headlines.length) {
    text += '**Headlines:**\n';
    for (const h of s.headlines) text += `• ${h}\n`;
  } else {
    text += 'No headlines found. Even the rumor mill is asleep. 😼';
  }
  return text;
}

// ── Moonshot Radar ──

async function findMoonshots(limit = 5) {
  const results = [];
  const quotes = await yahooQuoteBatch(WATCHLIST);

  for (const sym of WATCHLIST) {
    try {
      const rows = await yahooChart(sym, '1mo', '1d');
      if (!rows || rows.length < 10) continue;

      const closes = rows.map(r => r.close);
      const volumes = rows.map(r => r.volume);
      const price = closes[closes.length - 1];
      const prevPrice = closes[closes.length - 2];
      const pct = ((price - prevPrice) / prevPrice) * 100;

      // Volume ratio
      const prevVol = volumes[volumes.length - 2] || 1;
      const volRatio = volumes[volumes.length - 1] / prevVol;

      // Near breakout (within 5% of 10-day high)
      const high10d = Math.max(...closes.slice(-10));
      const nearBreakout = price >= 0.95 * high10d;

      // Stealth filter: small move + high volume + near breakout
      if (price >= 5 && Math.abs(pct) <= 4 && volRatio >= 2.0 && nearBreakout) {
        results.push({
          ticker: sym,
          name: quotes[sym]?.name || sym,
          price,
          pct: +pct.toFixed(2),
          vol_ratio: +volRatio.toFixed(1),
        });
      }
    } catch { continue; }
  }

  results.sort((a, b) => b.vol_ratio - a.vol_ratio);
  return results.slice(0, limit);
}

function formatMoonshots(picks) {
  if (!picks.length) return 'No stealth rockets today. Kabuneko is watching the usual suspects instead. 🐾';

  const snarks = [
    'Quiet before the storm. 🌩️',
    'Smart money sniffing around. 🐋',
    'Could pop off any second. 🎇',
    'Retail hasn\'t noticed yet. 👀',
  ];

  let text = '🚀 **Kabuneko\'s Pre-Moon Radar (Breakout Watch):**\n\n';
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    const snark = snarks[i % snarks.length];
    text += `\`${i + 1}.\` **${p.ticker}** (${p.name}) $${p.price.toFixed(2)} `;
    text += `(${p.pct >= 0 ? '+' : ''}${p.pct}%, Vol ${p.vol_ratio}× avg) — ${snark}\n`;
  }
  return text;
}

// ── Chart Data (for frontend rendering) ──

// ── Yahoo Finance v10 Fundamentals (matches yf.Ticker().info) ──

async function yahooFundamentals(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=defaultKeyStatistics,financialData,summaryDetail`;
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    const data = await resp.json();
    const ks = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics || {};
    const fd = data?.quoteSummary?.result?.[0]?.financialData || {};
    const sd = data?.quoteSummary?.result?.[0]?.summaryDetail || {};

    const raw = (obj) => obj?.raw ?? obj?.rawValue ?? obj ?? null;

    return {
      revenueGrowth: raw(fd.revenueGrowth),
      grossMargins: raw(fd.grossMargins),
      returnOnEquity: raw(fd.returnOnEquity),
      debtToEquity: raw(fd.debtToEquity),
      payoutRatio: raw(sd.payoutRatio),
      dividendYield: raw(sd.dividendYield),
      marketCap: raw(sd.marketCap),
      forwardPE: raw(sd.forwardPE) || raw(ks.forwardPE),
      trailingPE: raw(sd.trailingPE),
      shortName: raw(sd.shortName),
    };
  } catch {
    return null;
  }
}

// ── Stock Ideas Generator (4 buckets — mirrors Discord bot) ──

async function generateIdeas(perBucket = 5) {
  // Batch fetch all quotes for price data
  const quotes = await yahooQuoteBatch(WATCHLIST);

  // ── 1. Value / Dislocation ── (same as existing dislocations but formatted for ideas)
  const valResults = [];
  for (const sym of WATCHLIST) {
    const q = quotes[sym];
    if (!q || !q.price) continue;
    const pe = q.forwardPE || q.trailingPE;
    const mc = q.marketCap;
    if (!pe || pe <= 0 || pe < 3 || pe > 60) continue;
    if (!mc || mc < 1e9) continue;

    const valueScore = (1.0 / pe) * 100;
    const low52 = q.fiftyTwoWeekLow || 0;
    const nearLow = low52 > 0 ? (q.price / low52 - 1) : 0;
    const discount = nearLow < 0.2 ? 0.3 : nearLow < 0.4 ? 0.15 : 0;

    let reason = `PE ${pe.toFixed(1)}`;
    if (nearLow < 0.15) reason += `, near 52w low`;
    if (q.dividendYield && q.dividendYield > 0.02) reason += `, yield ${(q.dividendYield * 100).toFixed(1)}%`;

    valResults.push({
      ticker: sym, name: q.name || sym, score: valueScore + discount,
      pe: +pe.toFixed(1), price: q.price, reason,
    });
  }
  valResults.sort((a, b) => b.score - a.score);
  const valTop = valResults.slice(0, perBucket);

  // ── 2. Momentum Leaders ──
  const momoResults = [];
  for (const sym of WATCHLIST) {
    try {
      const rows = await yahooChart(sym, '1y', '1d');
      if (!rows || rows.length < 60) continue;
      const closes = rows.map(r => r.close);
      const volumes = rows.map(r => r.volume);
      const price = closes[closes.length - 1];
      if (price < 5) continue;

      // Average daily volume check (ADV20 >= 2M like your bot)
      const vol20 = volumes.slice(-20);
      const adv20 = vol20.reduce((a, b) => a + b, 0) / vol20.length;
      if (adv20 < 2_000_000) continue;

      const ret = (days) => {
        if (closes.length <= days) return null;
        const old = closes[closes.length - 1 - days];
        return old > 0 ? (price / old - 1) : null;
      };

      const r1m = ret(21), r3m = ret(63), r6m = ret(126), r12m = ret(252);
      if (r1m == null && r3m == null) continue;

      const rsi = calcRSI(closes);
      const latestRSI = rsi.filter(v => v != null).pop() || 50;

      // Weighted multi-TF momentum (matches _momentum_score)
      let score = 0;
      const parts = [], weights = [];
      if (r12m != null) { parts.push(r12m); weights.push(0.4); }
      if (r6m != null) { parts.push(r6m); weights.push(0.3); }
      if (r3m != null) { parts.push(r3m); weights.push(0.2); }
      if (r1m != null) { parts.push(r1m); weights.push(0.1); }
      if (!parts.length) continue;

      const totalW = weights.reduce((a, b) => a + b, 0);
      score = parts.reduce((sum, v, i) => sum + v * weights[i], 0) / totalW;

      if (latestRSI > 80) score -= 0.05;

      momoResults.push({
        ticker: sym, name: quotes[sym]?.name || sym, score,
        r1m, r3m, r6m, rsi: latestRSI, price, adv20: Math.round(adv20),
      });
    } catch { continue; }
  }
  momoResults.sort((a, b) => b.score - a.score);
  const momoTop = momoResults.slice(0, perBucket);

  // ── 3. Quality Growth ── (matches your bot: revenueGrowth>=0.15, grossMargins>=0.40, ROE>=0.15, D/E<=2.0)
  const qualResults = [];
  for (const sym of WATCHLIST) {
    try {
      const info = await yahooFundamentals(sym);
      if (!info) continue;

      const rg = info.revenueGrowth || 0;
      const gm = info.grossMargins || 0;
      const roe = info.returnOnEquity || 0;
      const dte = info.debtToEquity || 0;
      const mc = info.marketCap || quotes[sym]?.marketCap || 0;

      // Quality screen — exact same filters as your Discord bot
      if (rg < 0.15 || gm < 0.40 || roe < 0.15 || dte > 2.0) continue;
      if (mc < 5e8 || mc > 5e11) continue;

      // Score: rg*0.5 + gm*0.3 + roe*0.2 - (dte>1.5)*0.05
      const score = rg * 0.5 + gm * 0.3 + roe * 0.2 - (dte > 1.5 ? 0.05 : 0);

      qualResults.push({
        ticker: sym, name: quotes[sym]?.name || sym, score,
        rg: +(rg * 100).toFixed(1), gm: +(gm * 100).toFixed(1),
        roe: +(roe * 100).toFixed(1), dte: +dte.toFixed(2),
        price: quotes[sym]?.price || 0,
      });
    } catch { continue; }
  }
  qualResults.sort((a, b) => b.score - a.score);
  const qualTop = qualResults.slice(0, perBucket);

  // ── 4. Income ── (matches your bot: dividendYield>=0.03, payoutRatio 0-0.8)
  const incResults = [];
  for (const sym of WATCHLIST) {
    try {
      const info = await yahooFundamentals(sym);
      if (!info) continue;

      const dy = info.dividendYield || 0;
      const payout = info.payoutRatio || 0;

      if (dy < 0.03) continue;
      if (payout <= 0 || payout > 0.8) continue;

      // Score: dy*0.7 + (0.8-payout)*0.3
      const score = dy * 0.7 + (0.8 - payout) * 0.3;

      incResults.push({
        ticker: sym, name: quotes[sym]?.name || sym, score,
        dy: +(dy * 100).toFixed(2), payout: +(payout * 100).toFixed(1),
        price: quotes[sym]?.price || 0,
      });
    } catch { continue; }
  }
  incResults.sort((a, b) => b.score - a.score);
  const incTop = incResults.slice(0, perBucket);

  return { value: valTop, momentum: momoTop, quality: qualTop, income: incTop };
}

function formatIdeas(ideas) {
  const { value, momentum, quality, income } = ideas;

  let text = '🧠 **Kabuneko Ideas:**\n\n';

  text += '**💎 Value / Dislocation**\n';
  if (value.length) {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      text += `\`${i + 1}.\` **${v.ticker}** $${v.price.toFixed(2)} — ${v.reason}\n`;
    }
  } else text += '—\n';

  text += '\n**🚀 Momentum Leaders**\n';
  if (momentum.length) {
    const pct = (v) => v != null ? `${(v * 100) >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '—';
    for (let i = 0; i < momentum.length; i++) {
      const m = momentum[i];
      text += `\`${i + 1}.\` **${m.ticker}** $${m.price.toFixed(2)} [1m ${pct(m.r1m)} | 3m ${pct(m.r3m)} | 6m ${pct(m.r6m)}]\n`;
    }
  } else text += '—\n';

  text += '\n**⭐ Quality Growth**\n';
  if (quality.length) {
    for (let i = 0; i < quality.length; i++) {
      const q = quality[i];
      text += `\`${i + 1}.\` **${q.ticker}** — rev +${q.rg}% | margin ${q.gm}% | ROE ${q.roe}% | D/E ${q.dte}\n`;
    }
  } else text += '—\n';

  text += '\n**💰 Income**\n';
  if (income.length) {
    for (let i = 0; i < income.length; i++) {
      const inc = income[i];
      text += `\`${i + 1}.\` **${inc.ticker}** — yield ${inc.dy}% | payout ${inc.payout}%\n`;
    }
  } else text += '—\n';

  text += '\nReply with a ticker to go deeper. Not financial advice — I\'m a cat. 😼';
  return text;
}

async function getChartData(ticker, range = '6mo') {
  ticker = ticker.toUpperCase();
  const rows = await yahooChart(ticker, range, '1d');
  if (!rows || rows.length < 5) return { error: `No chart data for ${ticker}` };

  const closes = rows.map(r => r.close);
  const highs = rows.map(r => r.high);
  const lows = rows.map(r => r.low);
  const volumes = rows.map(r => r.volume);

  return {
    ticker,
    range,
    dates: rows.map(r => r.date.toISOString()),
    open: rows.map(r => r.open),
    high: highs,
    low: lows,
    close: closes,
    volume: volumes,
    sma50: calcSMA(closes, 50),
    sma200: calcSMA(closes, 200),
    rsi: calcRSI(closes),
    bb: calcBollingerBands(closes),
    macd: calcMACD(closes),
  };
}

// ── Export Everything ──

export {
  // Data fetching
  yahooQuoteBatch,
  yahooChart,

  // Indicators
  calcSMA, calcEMA, calcRSI, calcATR, calcADX, calcMACD, calcBollingerBands,

  // Analysis functions
  quantStats,
  getMarketSnapshot,  formatMarketSnapshot,
  getQuote,           formatQuote,
  analyzeStock,       formatAnalysis,
  momentumScan,       formatMomentum,
  dislocations,       formatDislocations,
  backtestRSI,        formatBacktest,
  getTickerNews,      analyzeSentiment,
  getSentiment,       formatSentiment,
  findMoonshots,      formatMoonshots,
  generateIdeas,      formatIdeas,
  getChartData,

  // Constants
  WATCHLIST,
  EMOJI_BANK,
};
