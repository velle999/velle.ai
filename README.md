# ⚡ VELLE.AI

Local AI that remembers you, talks back, runs quant analysis, and executes system commands. Everything on your machine — no cloud, no leash.

## Quick Start

### Prerequisites

1. **Node.js** (v18+)
2. **Ollama** — Install from [ollama.ai](https://ollama.ai)

### Setup

```bash
# 1. Pull a model
ollama pull qwen3:8b

# 2. Install dependencies
npm install

# 3. Run
$env:MODEL="qwen3:8b"; npm start
```

Open **http://localhost:3000**

## Architecture

```
velle-ai/
├── server/
│   ├── index.js          # Express + WebSocket server, Ollama integration
│   ├── memory.js         # SQLite memory manager
│   ├── commands.js       # System + quant command executor
│   └── quant.js          # Kabuneko quant engine (market data, TA, momentum)
├── personalities/
│   └── profiles.json     # Personality definitions
├── public/
│   └── index.html        # Cyberpunk terminal UI + voice engine + charts
├── memory/
│   └── companion.db      # SQLite database (auto-created)
└── package.json
```

## Features

### Personalities
- 🤖 **Default** — Helpful and conversational
- 😏 **Sarcastic** — Dry wit, playful roasts
- 😈 **Evil Genius** — Bond villain energy
- ⚡ **Anime Mentor** — Everything is a training arc
- 😴 **Sleepy** — Drowsy but insightful
- 😼 **Kabuneko** — Sarcastic quant-savvy finance gremlin
- 🔮 **Netrunner** — Cyberpunk street runner

### Voice (two-way)
- **Speech-to-Text**: Browser-native Web Speech API
- **Text-to-Speech**: System voices with auto-read toggle
- **Push-to-talk**: Hold mic button or Space bar
- **Hands-free mode**: Continuous listen → respond → listen loop
- **Audio visualizer**: Real-time mic level bars
- **Voice selector**: Pick from installed system voices

### Kabuneko Quant Engine
Slash commands from chat:
```
/market              — Indices, macro, crypto snapshot
/quote NVDA          — Quick price quote
/analyze AAPL        — Full quant report (RSI, MACD, BB, ADX, Sharpe, etc.)
/chart TSLA 1y       — Interactive canvas chart with indicators
/momentum            — Multi-timeframe momentum leaders
/dislocate           — Value dislocation scanner
/backtest AMD        — RSI strategy backtest vs buy & hold
/sentiment PLTR      — News headline sentiment scan
/moonshot            — Stealth breakout radar
```

### Memory System
- **Explicit saves**: "remember that I like coffee"
- **Auto-detection**: Preferences captured silently
- **Context injection**: Relevant memories in every prompt
- **Persistent**: SQLite, survives across sessions

### System Commands
Whitelisted actions the AI can trigger:
- `open_browser`, `open_app`, `play_music`, `set_reminder`, `system_info`

## Environment Variables

```bash
PORT=3000                                # Server port
OLLAMA_URL=http://localhost:11434        # Ollama API endpoint
MODEL=qwen3:8b                          # Model name
```
