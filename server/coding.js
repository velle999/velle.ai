// ═══════════════════════════════════════════════════════════════
//  VELLE.AI CODING TOOLS
//  Code runner, snippet manager, regex tester, format/lint,
//  encode/decode, diff, project scaffolding, port scanner
// ═══════════════════════════════════════════════════════════════

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, '..', '.tmp');
if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

// ═══════════════════════════════════
//  1. CODE RUNNER
// ═══════════════════════════════════

const RUNNERS = {
  javascript: { ext: '.js', cmd: (f) => `node "${f}"` },
  js: { ext: '.js', cmd: (f) => `node "${f}"` },
  python: { ext: '.py', cmd: (f) => `python3 "${f}"` },
  py: { ext: '.py', cmd: (f) => `python3 "${f}"` },
  bash: { ext: '.sh', cmd: (f) => `bash "${f}"` },
  sh: { ext: '.sh', cmd: (f) => `bash "${f}"` },
  typescript: { ext: '.ts', cmd: (f) => `npx tsx "${f}"` },
  ts: { ext: '.ts', cmd: (f) => `npx tsx "${f}"` },
  rust: { ext: '.rs', cmd: (f, out) => `rustc "${f}" -o "${out}" && "${out}"` },
  go: { ext: '.go', cmd: (f) => `go run "${f}"` },
  c: { ext: '.c', cmd: (f, out) => `gcc "${f}" -o "${out}" && "${out}"` },
  cpp: { ext: '.cpp', cmd: (f, out) => `g++ "${f}" -o "${out}" && "${out}"` },
};

async function runCode(code, lang = 'javascript') {
  const runner = RUNNERS[lang.toLowerCase()];
  if (!runner) return { error: `Unsupported language: ${lang}. Supported: ${Object.keys(RUNNERS).filter(k => k.length > 2).join(', ')}` };

  const id = Date.now().toString(36);
  const srcFile = join(TEMP_DIR, `run_${id}${runner.ext}`);
  const outFile = join(TEMP_DIR, `run_${id}`);

  writeFileSync(srcFile, code);

  try {
    const cmd = runner.cmd(srcFile, outFile);
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 });
    return {
      success: true,
      output: (stdout || '').trim(),
      stderr: (stderr || '').trim(),
      lang,
    };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout || '').trim(),
      error: (err.stderr || err.message || '').trim(),
      lang,
    };
  } finally {
    try { unlinkSync(srcFile); } catch {}
    try { unlinkSync(outFile); } catch {}
    try { unlinkSync(outFile + '.exe'); } catch {}
  }
}

function formatRunResult(r) {
  if (r.error && !r.output) return `❌ **Error (${r.lang || '?'}):**\n\`\`\`\n${r.error}\n\`\`\``;
  let text = `▶️ **Run (${r.lang}):**\n`;
  if (r.output) text += `\`\`\`\n${r.output.slice(0, 2000)}\n\`\`\``;
  if (r.stderr) text += `\n⚠ stderr:\n\`\`\`\n${r.stderr.slice(0, 500)}\n\`\`\``;
  if (!r.output && !r.stderr) text += '(no output)';
  return text;
}

// ═══════════════════════════════════
//  2. SNIPPET MANAGER (SQLite)
// ═══════════════════════════════════

export class SnippetManager {
  constructor(db) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      language TEXT DEFAULT 'javascript',
      tags TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    )`);
  }

  save(name, code, language = 'javascript', tags = null) {
    const stmt = this.db.prepare('INSERT INTO snippets (name, code, language, tags) VALUES (?, ?, ?, ?)');
    const r = stmt.run(name, code, language, tags);
    return { id: r.lastInsertRowid, name, language };
  }

  get(id) {
    return this.db.prepare('SELECT * FROM snippets WHERE id = ?').get(id);
  }

  getAll() {
    return this.db.prepare('SELECT id, name, language, tags, created_at FROM snippets ORDER BY id DESC').all();
  }

  search(query) {
    return this.db.prepare('SELECT * FROM snippets WHERE name LIKE ? OR code LIKE ? OR tags LIKE ? ORDER BY id DESC')
      .all(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  update(id, code) {
    this.db.prepare('UPDATE snippets SET code = ?, updated_at = datetime("now","localtime") WHERE id = ?').run(code, id);
    return this.get(id);
  }

  delete(id) {
    this.db.prepare('DELETE FROM snippets WHERE id = ?').run(id);
  }
}

function formatSnippetList(snippets) {
  if (!snippets.length) return '📦 No snippets saved. Use `/snippet save name lang | code` to create one.';
  let text = '📦 **Saved Snippets:**\n\n';
  for (const s of snippets) {
    text += `\`#${s.id}\` **${s.name}** (${s.language})${s.tags ? ` [${s.tags}]` : ''}\n`;
  }
  return text;
}

// ═══════════════════════════════════
//  3. REGEX TESTER
// ═══════════════════════════════════

function testRegex(pattern, flags, testString) {
  try {
    const re = new RegExp(pattern, flags || 'g');
    const matches = [...testString.matchAll(re)];
    if (!matches.length) return { success: true, matches: [], count: 0, pattern, flags };

    return {
      success: true,
      pattern,
      flags: flags || 'g',
      count: matches.length,
      matches: matches.slice(0, 20).map((m, i) => ({
        index: m.index,
        match: m[0],
        groups: m.slice(1),
      })),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function formatRegexResult(r) {
  if (!r.success) return `❌ Invalid regex: ${r.error}`;
  if (r.count === 0) return `🔍 \`/${r.pattern}/${r.flags}\` — **No matches**`;

  let text = `🔍 \`/${r.pattern}/${r.flags}\` — **${r.count} match${r.count > 1 ? 'es' : ''}**\n\n`;
  for (const m of r.matches) {
    text += `  \`[${m.index}]\` "${m.match}"`;
    if (m.groups.length) text += ` → groups: ${m.groups.map(g => `"${g}"`).join(', ')}`;
    text += '\n';
  }
  return text;
}

// ═══════════════════════════════════
//  4. ENCODE/DECODE TOOLS
// ═══════════════════════════════════

function encodeBase64(text) { return Buffer.from(text).toString('base64'); }
function decodeBase64(text) { return Buffer.from(text, 'base64').toString('utf-8'); }
function encodeURL(text) { return encodeURIComponent(text); }
function decodeURL(text) { return decodeURIComponent(text); }
function encodeHex(text) { return Buffer.from(text).toString('hex'); }
function decodeHex(text) { return Buffer.from(text, 'hex').toString('utf-8'); }
function hashText(text, algo = 'sha256') { return createHash(algo).update(text).digest('hex'); }

function formatEncodeDecode(op, input, output) {
  return `🔧 **${op}:**\n\`\`\`\n${output}\n\`\`\``;
}

// ═══════════════════════════════════
//  5. JSON TOOLS
// ═══════════════════════════════════

function jsonPretty(text) {
  try {
    return { success: true, output: JSON.stringify(JSON.parse(text), null, 2) };
  } catch (err) {
    return { success: false, error: `Invalid JSON: ${err.message}` };
  }
}

function jsonMinify(text) {
  try {
    return { success: true, output: JSON.stringify(JSON.parse(text)) };
  } catch (err) {
    return { success: false, error: `Invalid JSON: ${err.message}` };
  }
}

function jsonValidate(text) {
  try {
    const parsed = JSON.parse(text);
    const type = Array.isArray(parsed) ? 'array' : typeof parsed;
    const keys = type === 'object' ? Object.keys(parsed).length : null;
    const len = type === 'array' ? parsed.length : null;
    return { valid: true, type, keys, length: len };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ═══════════════════════════════════
//  6. DIFF TOOL
// ═══════════════════════════════════

function diffStrings(a, b) {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const result = [];
  const maxLen = Math.max(linesA.length, linesB.length);

  for (let i = 0; i < maxLen; i++) {
    const la = linesA[i];
    const lb = linesB[i];
    if (la === lb) {
      result.push({ type: 'same', line: i + 1, text: la });
    } else if (la === undefined) {
      result.push({ type: 'added', line: i + 1, text: lb });
    } else if (lb === undefined) {
      result.push({ type: 'removed', line: i + 1, text: la });
    } else {
      result.push({ type: 'removed', line: i + 1, text: la });
      result.push({ type: 'added', line: i + 1, text: lb });
    }
  }
  return result;
}

function formatDiff(result) {
  const changes = result.filter(r => r.type !== 'same');
  if (!changes.length) return '✅ Files are identical.';

  let text = `📝 **Diff** — ${changes.length} change${changes.length > 1 ? 's' : ''}:\n\`\`\`diff\n`;
  for (const r of result.slice(0, 100)) {
    if (r.type === 'same') text += `  ${r.text}\n`;
    else if (r.type === 'removed') text += `- ${r.text}\n`;
    else if (r.type === 'added') text += `+ ${r.text}\n`;
  }
  text += '```';
  return text;
}

// ═══════════════════════════════════
//  7. PROJECT SCAFFOLDING
// ═══════════════════════════════════

const TEMPLATES = {
  'node': {
    name: 'Node.js Project',
    files: {
      'package.json': `{\n  "name": "my-project",\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "start": "node index.js",\n    "dev": "node --watch index.js"\n  }\n}`,
      'index.js': `console.log('Hello World!');`,
      '.gitignore': `node_modules\n.env\ndist`,
    }
  },
  'express': {
    name: 'Express API',
    files: {
      'package.json': `{\n  "name": "my-api",\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "start": "node server.js",\n    "dev": "node --watch server.js"\n  },\n  "dependencies": {\n    "express": "^4.21.0"\n  }\n}`,
      'server.js': `import express from 'express';\nconst app = express();\napp.use(express.json());\n\napp.get('/', (req, res) => res.json({ message: 'Hello World' }));\n\napp.listen(3000, () => console.log('Server running on :3000'));`,
      '.gitignore': `node_modules\n.env\ndist`,
    }
  },
  'python': {
    name: 'Python Project',
    files: {
      'main.py': `def main():\n    print("Hello World!")\n\nif __name__ == "__main__":\n    main()`,
      'requirements.txt': `# Add dependencies here`,
      '.gitignore': `__pycache__\n*.pyc\nvenv\n.env`,
    }
  },
  'html': {
    name: 'HTML/CSS/JS',
    files: {
      'index.html': `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>My App</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hello World</h1>\n  <script src="app.js"></script>\n</body>\n</html>`,
      'style.css': `* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: system-ui; padding: 2rem; }`,
      'app.js': `console.log('App loaded');`,
    }
  },
  'react': {
    name: 'React (Vite)',
    files: {
      'package.json': `{\n  "name": "my-react-app",\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  },\n  "dependencies": {\n    "react": "^18.2.0",\n    "react-dom": "^18.2.0"\n  },\n  "devDependencies": {\n    "@vitejs/plugin-react": "^4.0.0",\n    "vite": "^5.0.0"\n  }\n}`,
      'index.html': `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>React App</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>\n</html>`,
      'src/main.jsx': `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
      'src/App.jsx': `export default function App() {\n  return <h1>Hello React!</h1>;\n}`,
      'vite.config.js': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });`,
      '.gitignore': `node_modules\ndist\n.env`,
    }
  },
};

function scaffoldProject(template, targetDir) {
  const tmpl = TEMPLATES[template.toLowerCase()];
  if (!tmpl) return { error: `Unknown template: ${template}. Available: ${Object.keys(TEMPLATES).join(', ')}` };

  const created = [];
  for (const [filePath, content] of Object.entries(tmpl.files)) {
    const fullPath = join(targetDir, filePath);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content);
    created.push(filePath);
  }
  return { success: true, template: tmpl.name, files: created };
}

function formatScaffold(r) {
  if (r.error) return `⚠ ${r.error}`;
  let text = `🏗️ **Scaffolded: ${r.template}**\n\nFiles created:\n`;
  for (const f of r.files) text += `  📄 ${f}\n`;
  return text;
}

// ═══════════════════════════════════
//  8. PORT SCANNER
// ═══════════════════════════════════

async function scanPorts(ports = [3000, 5000, 5173, 8000, 8080, 8888, 4200, 4321, 1234]) {
  const results = [];
  const net = await import('net');

  for (const port of ports) {
    const inUse = await new Promise((resolve) => {
      const s = net.default.createServer();
      s.once('error', () => resolve(true));
      s.once('listening', () => { s.close(); resolve(false); });
      s.listen(port);
    });
    results.push({ port, inUse });
  }
  return results;
}

function formatPorts(results) {
  let text = '🔌 **Port Scanner:**\n\n';
  for (const r of results) {
    text += `  ${r.inUse ? '🔴' : '🟢'} :${r.port} — ${r.inUse ? 'IN USE' : 'available'}\n`;
  }
  return text;
}

// ═══════════════════════════════════
//  9. QUICK HTTP REQUEST
// ═══════════════════════════════════

async function httpRequest(url, method = 'GET', body = null, headers = {}) {
  try {
    const opts = {
      method,
      headers: { 'User-Agent': 'VELLE.AI/1.0', ...headers },
      signal: AbortSignal.timeout(10000),
    };
    if (body && method !== 'GET') {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    }
    const resp = await fetch(url, opts);
    const contentType = resp.headers.get('content-type') || '';
    const isJson = contentType.includes('json');
    const text = await resp.text();
    return {
      success: true,
      status: resp.status,
      statusText: resp.statusText,
      headers: Object.fromEntries(resp.headers.entries()),
      body: isJson ? JSON.parse(text) : text,
      isJson,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function formatHttpResult(r) {
  if (!r.success) return `❌ Request failed: ${r.error}`;
  let text = `🌐 **${r.status} ${r.statusText}**\n`;
  if (r.isJson) {
    text += `\`\`\`json\n${JSON.stringify(r.body, null, 2).slice(0, 2000)}\n\`\`\``;
  } else {
    text += `\`\`\`\n${String(r.body).slice(0, 2000)}\n\`\`\``;
  }
  return text;
}

// ═══════════════════════════════════
//  10. CODE STATS (count lines)
// ═══════════════════════════════════

function countLines(dir, extensions = ['.js', '.ts', '.py', '.jsx', '.tsx', '.css', '.html', '.rs', '.go', '.c', '.cpp']) {
  const stats = {};
  let totalFiles = 0;
  let totalLines = 0;

  function walk(d) {
    try {
      const entries = readdirSync(d);
      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
        const full = join(d, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else {
          const ext = extname(entry).toLowerCase();
          if (extensions.includes(ext)) {
            const lines = readFileSync(full, 'utf-8').split('\n').length;
            stats[ext] = (stats[ext] || 0) + lines;
            totalFiles++;
            totalLines += lines;
          }
        }
      }
    } catch {}
  }

  walk(dir);
  return { stats, totalFiles, totalLines };
}

function formatCodeStats(r) {
  let text = `📊 **Code Stats:**\n\n`;
  text += `  📁 Files: **${r.totalFiles}**\n`;
  text += `  📝 Lines: **${r.totalLines.toLocaleString()}**\n\n`;
  const sorted = Object.entries(r.stats).sort((a, b) => b[1] - a[1]);
  for (const [ext, lines] of sorted) {
    const pct = ((lines / r.totalLines) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    text += `  \`${ext.padEnd(6)}\` ${bar} ${lines.toLocaleString()} (${pct}%)\n`;
  }
  return text;
}

// ═══════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════

export {
  // Code runner
  runCode, formatRunResult, RUNNERS,

  // Snippets
  formatSnippetList,

  // Regex
  testRegex, formatRegexResult,

  // Encode/Decode
  encodeBase64, decodeBase64, encodeURL, decodeURL,
  encodeHex, decodeHex, hashText, formatEncodeDecode,

  // JSON
  jsonPretty, jsonMinify, jsonValidate,

  // Diff
  diffStrings, formatDiff,

  // Scaffold
  scaffoldProject, formatScaffold, TEMPLATES,

  // Ports
  scanPorts, formatPorts,

  // HTTP
  httpRequest, formatHttpResult,

  // Stats
  countLines, formatCodeStats,
};
