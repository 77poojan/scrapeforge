# ScrapeForge × Notion MCP

> **One sentence in Claude Desktop → any website becomes a structured Notion database.**

[![Backend Live](https://img.shields.io/badge/Backend-Live%20on%20Railway-success)](https://scrapyforge-production.up.railway.app/api/health)
[![Docker Hub](https://img.shields.io/badge/Docker-pujanbade-blue)](https://hub.docker.com/u/pujanbade)
[![MLH Notion AI Challenge](https://img.shields.io/badge/MLH-Notion%20AI%20Challenge-purple)](https://mlh.io)

---

## What it does

Type this in Claude Desktop:

```
Research "NEPSE stock market" and save to my Notion page abc123
```

Claude scrapes 3 sites, structures everything with AI, and builds this in Notion automatically:

```
📁 Research: NEPSE Stock Market
  ├── 1. MeroLagani    — Live stock prices, gainers, losers
  ├── 2. ShareSansar   — Market summary, indices
  └── 3. Nepal Stock   — Trading data
📊 Research Summary (auto-generated)
```

No manual work. No copy-pasting. Just one sentence.

---

## Setup (3 steps, ~5 minutes)

### Step 1 — Get free keys

| Key | Where |
|---|---|
| Groq API (free) | https://console.groq.com → API Keys → Create → copy `gsk_...` |
| Notion Token | https://notion.so/my-integrations → New integration → copy `secret_...` |

**Connect Notion to your page:**
Open any Notion page → `...` → Connections → add your integration

**Get your Notion Page ID:**
```
https://notion.so/My-Page-abc123def456  →  Page ID = abc123def456
```

---

### Step 2 — Install MCP

```bash
git clone https://github.com/pujanbade/scrapeforge-notion
cd scrapeforge-notion/notion-mcp
npm install
```

Find your node path:
```bash
which node
# e.g. /usr/local/bin/node
#      /opt/homebrew/bin/node
#      /Users/name/.nvm/versions/node/v20.x.x/bin/node
```

---

### Step 3 — Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "notion-mcp": {
      "command": "/your/node/path/here",
      "args": ["/absolute/path/to/scrapeforge-notion/notion-mcp/index.js"],
      "env": {
        "NOTION_TOKEN": "secret_xxxx",
        "GROQ_API_KEY": "gsk_xxxx",
        "SCRAPEFORGE_BACKEND": "https://scrapyforge-production.up.railway.app",
        "DEFAULT_PAGE_ID": "your_notion_page_id"
      }
    }
  }
}
```

Restart Claude Desktop:
```bash
pkill -f Claude && sleep 2 && open /Applications/Claude.app
```

✅ **No Docker. No `.env` file. No local backend needed.**

---

## Test it

Type in Claude Desktop:
```
Research "AI trends 2025" and save to my Notion page YOUR_PAGE_ID
```

Watch your Notion workspace fill up automatically! 🎉

---

## More commands to try

```
Research "Nepal stock market" and save to my Notion page PAGE_ID

Scrape https://quotes.toscrape.com and save all quotes to Notion page PAGE_ID

Research "Nepal news today" and save to page PAGE_ID

Scrape https://bbc.com/nepali and save headlines to Notion page PAGE_ID

Show me everything in my Notion database DATABASE_ID
```

---

## MCP Tools

| Tool | What it does |
|---|---|
| ⭐ `research_assistant` | Research any topic → scrapes 3-5 sites → full Notion workspace |
| `scrape_to_notion_page` | Deep scrape with Playwright → Notion page |
| `scrape_quick_to_page` | Fast scrape → Notion page |
| `scrape_to_notion_db` | Scrape → row in Notion database |
| `notion_create_page` | Plain text → new Notion page |
| `notion_append_blocks` | Add content to existing page |
| `notion_query_db` | Query a Notion database |
| `notion_get_page` | Read a Notion page |

---

## Architecture

```
You type in Claude Desktop
        ↓ MCP protocol
notion-mcp/index.js  (runs locally)
        ↓ HTTP
https://scrapyforge-production.up.railway.app
        ↓
Express API → Python Scrapy + Playwright
        ↓
Groq AI — Llama 3.3 70B (free)
        ↓
Notion API → pages created ✅
```

---

## Tech Stack

`Python Scrapy` · `Playwright` · `Groq AI (free)` · `Node.js MCP` · `Notion API` · `React` · `Railway` · `Docker`

---

## Verify backend is live

```bash
curl https://scrapyforge-production.up.railway.app/api/health
# {"ok":true}
```

---

## Troubleshooting

**No hammer icon in Claude Desktop:**
```bash
# 1. Get your full node path
which node

# 2. Use it in "command" field — not just "node"
# Wrong:  "command": "node"
# Right:  "command": "/usr/local/bin/node"

# 3. Restart Claude Desktop
pkill -f Claude && open /Applications/Claude.app
```

**Test MCP manually:**
```bash
NOTION_TOKEN=secret_xxx \
GROQ_API_KEY=gsk_xxx \
node notion-mcp/index.js
# Should print: [notion-mcp] ✅ Server running on stdio
```

**Backend not responding:**
```bash
curl https://scrapyforge-production.up.railway.app/api/health
# Should return {"ok":true}
```

---

*Built for MLH Global Hack Week — The Notion AI Challenge* 🏆