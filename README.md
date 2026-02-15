# 🤖 AI Companion

A locally running AI assistant that remembers things about you, talks in different personalities, and runs commands on your system. Everything stays on your machine.

## Quick Start

### Prerequisites

1. **Node.js** (v18+)
2. **Ollama** — Install from [ollama.ai](https://ollama.ai)

### Setup

```bash
# 1. Pull a model (pick one)
ollama pull llama3.2          # 3B — fast, good for conversation
ollama pull llama3.1          # 8B — smarter, needs more RAM
ollama pull mistral           # 7B — good alternative

# 2. Install dependencies
cd ai-companion
npm install

# 3. Run
npm start
# or with file watching for dev:
npm run dev
```

Open **http://localhost:3000** and start chatting.

### Environment Variables

```bash
PORT=3000                                # Server port
OLLAMA_URL=http://localhost:11434        # Ollama API endpoint
MODEL=llama3.2                           # Model name (must be pulled in Ollama)
```

Example with a different model:
```bash
MODEL=mistral npm start
```

## Architecture

```
ai-companion/
├── server/
│   ├── index.js          # Express + WebSocket server, Ollama integration
│   ├── memory.js         # SQLite memory manager (conversations, facts, search)
│   └── commands.js       # Whitelist-based system command executor
├── personalities/
│   └── profiles.json     # Personality definitions (system prompts, styles)
├── public/
│   └── index.html        # Cyberpunk terminal chat UI (single file)
├── memory/
│   └── companion.db      # SQLite database (auto-created)
└── package.json
```

## Features

### Personalities
Switch between modes that change the AI's system prompt, temperature, and UI theme:
- 🤖 **Default** — Helpful and conversational
- 😏 **Sarcastic** — Dry wit, playful roasts
- 😈 **Evil Genius** — Bond villain energy
- ⚡ **Anime Mentor** — Everything is a training arc
- 😴 **Sleepy** — Drowsy but insightful
- 🔮 **Netrunner** — Cyberpunk street runner

### Memory System
- **Explicit saves**: Say "remember that I like coffee" and it's stored
- **Auto-detection**: Preferences and facts are silently captured
- **Context injection**: Relevant memories are pulled into each conversation
- **Persistent**: Memories survive across sessions (stored in SQLite)

### System Commands
The AI can execute whitelisted commands when you ask:
- `open_browser` — Opens a URL
- `open_app` — Opens allowed apps (file manager, terminal, calculator, etc.)
- `play_music` — Searches YouTube for music
- `set_reminder` — Logs a reminder
- `system_info` — Shows system stats
- `run_shell` — Runs safe shell commands (date, whoami, etc.)

### Streaming
Responses stream token-by-token via WebSocket for a responsive feel.

## Extending

### Add a personality
Edit `personalities/profiles.json` and add a new entry:
```json
"pirate": {
  "name": "Pirate",
  "icon": "🏴‍☠️",
  "temperature": 0.85,
  "system_prompt": "You are a pirate AI. Speak like a sea dog...",
  "greeting": "Ahoy! What be yer query?",
  "style": { "accent_color": "#ff8800", "glow_intensity": 1.3 }
}
```

### Add a command
Edit `server/commands.js` and add to `COMMAND_HANDLERS`:
```js
my_command: async (params) => {
  // do something
  return { success: true, result: 'Done!' };
}
```

### Upgrade memory to vector search
Replace SQLite keyword search with `sqlite-vec` for semantic search:
1. `npm install sqlite-vec`
2. Generate embeddings via Ollama's `/api/embed` endpoint
3. Store embeddings alongside memories
4. Use cosine similarity for retrieval

## Roadmap

- [ ] Voice input (whisper.cpp)
- [ ] Voice output (Piper TTS)
- [ ] Proactive reminders / notifications
- [ ] Daily conversation summaries
- [ ] Vector search for memories
- [ ] Electron desktop wrapper
- [ ] Mood drift system
- [ ] Local file search assistant
