# ⚡ VELLE.AI

Your local AI operating system. Memory, voice, quant engine, productivity suite, journal, habits, goals, achievements — all running on your machine. No cloud. No leash.

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Ollama](https://img.shields.io/badge/Ollama-local_LLM-blue) ![SQLite](https://img.shields.io/badge/SQLite-persistent-orange) 
---

🚀 Quick Start Portable EXE

1. Install Ollama

Download and install Ollama from
https://ollama.com



2. Download a local model

ollama pull qwen3:8b




3. Launch VELLE.AI
Run the portable executable

VELLE-AI-1.0.0-portable.exe


Admin recommended for full system access features



4. Start using your AI OS
The full interface opens instantly

## Architecture

```
velle-ai/
├── server/
│   ├── index.js            # Express + WebSocket server, Ollama, 50+ slash commands
│   ├── memory.js           # SQLite memory manager (conversations, memories, context)
│   ├── commands.js         # System command executor (PowerShell/bash, apps, browser)
│   ├── quant.js            # Kabuneko quant engine (Yahoo Finance, TA indicators)
│   ├── advanced.js         # Reminders, mood tracking, summaries, journal, file search
│   └── productivity.js     # Todos, habits, pomodoro, goals, bookmarks, KB, achievements, insights, briefing
├── public/
│   └── index.html          # Cyberpunk terminal UI + voice engine + chart renderer
├── personalities/
│   └── profiles.json       # 7 AI personality profiles
├── memory/
│   └── companion.db        # SQLite database (auto-created on first run)
├── package.json
└── README.md
```

**Total codebase:** ~5,600 lines across 6 server modules + 2,100 line UI

---

## Features

### 🎭 Personalities

Switch between 7 AI personalities, each with unique system prompts, temperature settings, and accent colors:

| ID | Icon | Name | Vibe |
|----|------|------|------|
| `default` | 🤖 | Default | Helpful and conversational |
| `sarcastic` | 😏 | Sarcastic | Dry wit, playful roasts |
| `evil` | 😈 | Evil Genius | Bond villain energy |
| `anime` | ⚡ | Anime Mentor | Everything is a training arc |
| `sleepy` | 😴 | Sleepy | Drowsy but insightful |
| `kabuneko` | 😼 | Kabuneko | Sarcastic quant-savvy finance gremlin |
| `netrunner` | 🔮 | Netrunner | Cyberpunk street runner |

---

### 🎤 Two-Way Voice

**Speech-to-Text** — Browser-native Web Speech API (Chrome/Edge required)
- **Push-to-talk**: Hold mic button or hold `Space` bar
- **Click toggle**: Tap mic to start/stop listening
- **Hands-free mode**: Continuous listen → send → wait for TTS → listen again
- **Audio visualizer**: 12-bar real-time mic level display
- **Live transcription**: See words appear in the input box as you speak

**Text-to-Speech** — System voice synthesis
- Toggle 🔇/🔊 button to enable
- Auto-read toggle in sidebar for always-on
- Voice selector with preferred English voices
- Strips markdown/emoji before speaking
- Chunks long responses for reliable playback
- Auto-pauses listening during TTS in hands-free mode

---

### 📊 Kabuneko Quant Engine

Full market analysis suite powered by Yahoo Finance + CoinGecko + Finviz. Pure JavaScript, zero Python dependencies.

```
/market                    — S&P 500, Nasdaq, Dow, futures, crypto, macro
/quote NVDA                — Price, PE, market cap, 52w range, volume
/analyze AAPL              — RSI, MACD, Bollinger, ADX, Sharpe, drawdown, patterns
/chart TSLA 1y             — Canvas chart with SMA50/200, volume, RSI zones
/momentum                  — Multi-timeframe momentum scoring (1/3/6/12m returns)
/dislocate                 — Value dislocation scanner by PE
/backtest AMD              — RSI(30/70) strategy backtest vs buy & hold
/sentiment PLTR            — Finviz headline scraping + keyword sentiment
/moonshot                  — Stealth breakout radar (high vol + small move + near high)
```

**Technical indicators:** SMA, EMA, RSI, MACD, Bollinger Bands, ADX, ATR
**Pattern detection:** Golden/Death Cross, RSI extremes, BB breakouts, MACD crossovers, 20-day highs/lows
**Chart renderer:** Canvas-based with price line, gradient fill, dual SMAs, volume bars, RSI with overbought/oversold zones

The LLM auto-enriches responses with live market data when you mention ticker symbols in natural conversation.

---

### 📋 Task Manager

```
/todo add Buy groceries p1 #personal @tomorrow
/todo add Fix login bug p2 #work @today
/todo done 5                — Complete task #5
/todo start 3               — Mark as in-progress
/todo overdue               — View overdue tasks
/todo today                 — Today's tasks
/todo projects              — View all projects with completion counts
/todo stats                 — Total, done, active, overdue, completion rate
```

**Features:** 4 priority levels (🔴🟡🟢⚪), project grouping (#tag), due dates (@date), status tracking (todo → doing → done)

---

### 🔄 Habit Tracker

```
/habit add Exercise         — Create a daily habit
/habit add Read 📚          — With custom icon
/habit check 1              — Check in for today
/habit uncheck 1            — Undo check-in
/habit                      — Dashboard with week grid + streaks
```

**Dashboard shows:**
```
✅ 💪 Exercise  🟩🟩🟩⬜🟩🟩🟩 🔥7 (85.3% / 30d)
☐ 📚 Read      🟩🟩⬜⬜🟩⬜🟩 🔥1 (46.7% / 30d)
```

---

### 🍅 Pomodoro Timer

```
/pomo start Deep work 25    — Start 25-minute focus session
/pomo start                  — Quick start (25 min default)
/pomo stop                   — End session early
/pomo status                 — Time remaining
/pomo stats                  — Today's focus time
/pomo week                   — Weekly focus time
```

Auto-notifies when timer ends. Logs completed sessions to SQLite.

---

### 🎯 Goal System

```
/goal add Learn Rust                    — Set a goal
/goal ms 1 Read The Rust Book           — Add milestone to goal #1
/goal ms 1 Build a CLI tool             — Add another milestone
/goal check 3                           — Complete milestone #3
/goal progress 1 60                     — Manually set 60% progress
/goal                                   — View all with progress bars
```

**Display:**
```
🎯 #1 Learn Rust █████░░░░░ 50%
   ✅ Read The Rust Book
   ☐ Build a CLI tool
```

Milestones auto-calculate goal progress percentage.

---

### 📓 Journal

```
/journal write Had a great coding session today
/journal prompt              — Random writing prompt (30 rotating prompts)
/journal today               — Today's entries
/journal                     — Recent entries
/journal streak              — View streak 🔥🔥🔥
/journal weekly              — Weekly reflection (avg mood, word count, themes)
/journal pin 5               — Pin/unpin entry
/journal search coffee       — Search entries
/journal read 12             — Full entry view
/journal delete 3            — Delete entry
```

**Features:** Auto-tags entries (work, code, health, money, social, mood, etc.), attaches mood score from mood tracker, streak tracking with longest streak record, 30 rotating writing prompts that avoid repeats.

---

### 🧠 Memory & Mood

**Memory System:**
- Say "remember that I like coffee" → saved explicitly
- Auto-detects preferences, work info, location, identity
- Auto-tags: preference, personal, work, tech, finance, health, location, schedule, goal, project
- Auto-importance scoring (name = 9, birthday = 8, goals = 7, casual = 3)
- Relevant memories injected into every LLM prompt

**Mood Tracking:**
```
/mood                        — Current mood + 7-day trend
```
- Tracks sentiment of every message (positive/negative words + emoji analysis)
- Detects triggers: work, money, relationships, health, coding, markets
- Trend analysis: improving 📈 / declining 📉 / stable
- Injected into system prompt — LLM adapts tone when you're down

---

### ⏰ Proactive Reminders

```
/remind in 10 minutes check email
/remind at 3:00pm meeting with Jake
/remind tomorrow call the dentist
/remind                      — View all pending
/cancelremind 5              — Cancel reminder #5
```

Supports repeating: `every day`, `weekly`, `hourly`, `monthly`
Fires as: in-chat notification + browser push notification + TTS if enabled
Also detects "remind me to..." in natural conversation and auto-sets.

---

### 🔖 Bookmarks & 📚 Knowledge Base

**Bookmarks** — Save important moments from conversations:
```
/bookmark save The API uses OAuth2 with PKCE flow #auth #api
/bookmark search auth
/bookmark                    — List all
```

**Knowledge Base** — Persistent notes, code snippets, links:
```
/kb add API Keys | sk-abc123-my-key-here
/kb add Git Cheatsheet | git rebase -i HEAD~3
/kb add Portfolio Link | https://velle.dev
/kb search git
/kb read 5
```
Auto-detects type: 📝 note, 💻 snippet, 🔗 link

---

### 📁 Local File Search

```
/find package.json           — Search by filename
/find TODO                   — Search file contents
```

Searches: Desktop, Documents, Downloads, Projects, Code, repos, src
Searches inside: .js, .py, .md, .json, .ts, .html, .css, .sql, .yaml, and 30+ more extensions
Skips: node_modules, .git, build, dist, __pycache__, venv

---

### 🏆 Achievements (25 badges)

Unlock automatically as you use VELLE.AI:

| Badge | Name | Requirement |
|-------|------|-------------|
| 🌟 | First Contact | Send first message |
| 💬 | Chatterbox | 100 messages |
| 🎖️ | Veteran | 1000 messages |
| 🐘 | Elephant | Save first memory |
| 📚 | Librarian | 10 memories |
| 📓 | Dear Diary | First journal entry |
| 🔥 | On a Roll | 3-day journal streak |
| ⚡ | Week Warrior | 7-day journal streak |
| 💎 | Iron Will | 30-day journal streak |
| ✅ | Getting Things Done | Complete first task |
| 🏆 | Task Master | 25 tasks completed |
| ⚙️ | Productivity Machine | 100 tasks completed |
| 🔄 | Habit Former | Create first habit |
| 🍅 | Focused | First pomodoro |
| 🧠 | Deep Worker | 25 pomodoros |
| 🎯 | Visionary | Set first goal |
| 🏅 | Goal Crusher | Complete a goal |
| 🦉 | Night Owl | Message after midnight |
| 🐦 | Early Bird | Message before 6am |
| ... | +6 more | ... |

Achievement toast slides in with gold glow animation on unlock.

---

### 💡 Auto-Insights

```
/insights
```

Analyzes your data and surfaces patterns:
- "work has been a recurring source of stress (4x this week)"
- "You created 15 tasks but only completed 3 — consider prioritizing fewer items"
- "You haven't journaled this week"
- "Your most active time is evening (around 9pm)"
- "You have 3 overdue tasks"

---

### ☀️ Daily Briefing

```
/briefing    (or /brief, /morning, /gm)
```

Generates a complete daily overview:
- Current mood + trend
- Upcoming reminders
- Task stats (active, overdue, completed today)
- Habit status with check/uncheck
- Goal progress bars
- Journal streak
- Today's focus time
- Achievement progress
- AI-generated insights

---

### 📊 Dashboard

```
/dashboard    (or /dash)
```

Quick aggregate view of all systems in one glance.

**REST API:** `GET /api/dashboard` returns JSON with mood, todos, habits, journal, pomodoro, goals, achievements, reminders, memory stats.

---

### 💻 System Commands

The LLM can execute system actions:
- `open_browser` — Opens URLs
- `open_app` — PowerShell, calculator, notepad, file manager, terminal
- `run_shell` — Executes PowerShell commands (Windows) or bash (Linux) with blocklist safety
- `play_music` — Opens default music player
- `system_info` — OS, CPU, memory, uptime

---

## All Slash Commands

| Category | Commands |
|----------|----------|
| **Quant** | `/market` `/quote` `/analyze` `/chart` `/momentum` `/dislocate` `/backtest` `/sentiment` `/moonshot` |
| **Tasks** | `/todo add\|done\|start\|del\|overdue\|today\|projects\|stats` |
| **Habits** | `/habit add\|check\|uncheck\|del\|dashboard` |
| **Focus** | `/pomo start\|stop\|status\|stats\|week` |
| **Goals** | `/goal add\|ms\|check\|progress\|del` |
| **Journal** | `/journal write\|prompt\|today\|streak\|weekly\|pin\|read\|search\|delete` |
| **Memory** | `/mood` `/summary` `/history` |
| **Reminders** | `/remind` `/cancelremind` |
| **Knowledge** | `/kb add\|search\|read\|del` |
| **Bookmarks** | `/bookmark save\|search\|del` |
| **Files** | `/find query` |
| **Overview** | `/dashboard` `/briefing` `/achievements` `/insights` `/help` |

---

## REST API

All endpoints at `http://localhost:3000/api/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/personalities` | GET | List personalities |
| `/api/memories` | GET | List memories |
| `/api/stats` | GET | System stats |
| `/api/dashboard` | GET | Aggregate dashboard |
| `/api/briefing` | GET | Daily briefing |
| `/api/todos` | GET/POST | Task CRUD |
| `/api/todos/:id/complete` | POST | Complete task |
| `/api/habits` | GET/POST | Habit CRUD |
| `/api/habits/:id/check` | POST | Check in |
| `/api/goals` | GET/POST | Goal CRUD |
| `/api/goals/:id/milestone` | POST | Add milestone |
| `/api/journal` | GET/POST | Journal CRUD |
| `/api/journal/streak` | GET | Streak data |
| `/api/journal/weekly` | GET | Weekly reflection |
| `/api/mood` | GET | Current mood |
| `/api/mood/history` | GET | Mood history |
| `/api/reminders` | GET/POST/DELETE | Reminder CRUD |
| `/api/kb` | GET/POST | Knowledge base |
| `/api/bookmarks` | GET/POST | Bookmarks |
| `/api/achievements` | GET | All achievements |
| `/api/insights` | GET | Auto-insights |
| `/api/pomodoro/start` | POST | Start session |
| `/api/pomodoro/today` | GET | Today's stats |
| `/api/files/search?q=` | GET | File search |
| `/api/quant/market` | GET | Market snapshot |
| `/api/quant/quote/:ticker` | GET | Stock quote |
| `/api/quant/analyze/:ticker` | GET | Full analysis |
| `/api/quant/chart/:ticker` | GET | Chart data |
| `/api/quant/momentum` | GET | Momentum scan |
| `/api/quant/sentiment/:ticker` | GET | Sentiment |

---

## Tech Stack

- **Runtime:** Node.js 18+
- **LLM:** Ollama (local, any model)
- **Database:** SQLite via better-sqlite3 (WAL mode)
- **Server:** Express + WebSocket (ws)
- **Frontend:** Vanilla JS, CSS custom properties, Canvas API
- **Voice:** Web Speech API (STT) + SpeechSynthesis (TTS)
- **Market Data:** Yahoo Finance v7/v8, CoinGecko, Finviz
- **Fonts:** JetBrains Mono + Orbitron

Zero external AI APIs. Zero telemetry. Everything local.

---
