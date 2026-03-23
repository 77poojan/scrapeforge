# ScrapeForge × Notion MCP

> **One sentence in Claude Desktop → any website becomes a structured Notion database.**

[![Backend Live](https://img.shields.io/badge/Backend-Live-success)](https://scrapyforge-production.up.railway.app/api/health)
[![MLH Notion AI Challenge](https://img.shields.io/badge/MLH-Notion%20AI%20Challenge-purple)](https://mlh.io)

---

## What it does

You type this in Claude Desktop:

```
Research "NEPSE stock market" and save to my Notion page abc123
```

Claude automatically scrapes 3 sites, structures the data with AI, and builds this in your Notion:

```
📁 Research: NEPSE Stock Market
  ├── 1. MeroLagani    — Live stock prices, gainers, losers
  ├── 2. ShareSansar   — Market summary, indices
  └── 3. Nepal Stock   — Trading data
📊 Summary (auto-generated)
```

**No manual work. No copy-pasting. Just one sentence.**

---

## Setup (5 minutes)

### Step 1 — Get free keys

| Key | Where | Looks like |
|---|---|---|
| Groq API (free) | https://console.groq.com → API Keys | `gsk_...` |
| Notion Token | https://notion.so/my-integrations → New integration | `secret_...` |

**Connect Notion to your page:**
Open any Notion page → click `...` → Connections → add your integration

**Get your Notion Page ID** from the URL:
```
https://notion.so/My-Page-abc123def456  →  Page ID = abc123def456
```

### Step 2 — Install MCP

```bash
git clone https://github.com/pujanbade/scrapeforge-notion
cd scrapeforge-notion/notion-mcp
npm install
```

### Step 3 — Configure Claude Desktop

Find your node path first:
```bash
which node
# e.g. /usr/local/bin/node or /opt/homebrew/bin/node
```

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "notion-mcp": {
      "command": "/your/path/to/node",
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

### Step 4 — Restart Claude Desktop and test

Quit Claude (Cmd+Q) and reopen it. Then type:

```
Research "AI trends 2025" and save to my Notion page YOUR_PAGE_ID
```

Watch your Notion fill up automatically. ✅

> **No Docker needed** — the backend runs live at `https://scrapyforge-production.up.railway.app`

---

## All 8 MCP Tools

| Tool | What it does |
|---|---|
| ⭐ `research_assistant` | Research any topic → scrapes 3-5 sites → full Notion workspace |
| `scrape_to_notion_page` | Deep scrape one URL (Playwright for JS sites) → Notion page |
| `scrape_quick_to_page` | Fast scrape one URL → Notion page |
| `scrape_to_notion_db` | Scrape URL → row in Notion database |
| `notion_create_page` | Create a page from plain text |
| `notion_append_blocks` | Add content to existing page |
| `notion_query_db` | Query a Notion database |
| `notion_get_page` | Read a Notion page |

---

## Try these commands

```
Research "Nepal stock market" and save to my Notion page PAGE_ID

Scrape https://quotes.toscrape.com and save all quotes to Notion page PAGE_ID

Research "Nepal news today" and save to page PAGE_ID

Scrape https://bbc.com/nepali and save headlines to Notion page PAGE_ID
```

---

## Run locally with Docker (optional)

```bash
cp .env.example .env      # fill in your keys
docker compose up          # pulls images from Docker Hub automatically
```

Open http://localhost:5173 for the web UI.

Use `http://localhost:5050` instead of the Railway URL in your MCP config.

---

## How it works

```
You → Claude Desktop → notion-mcp
                            ↓
              Railway backend (Express + Python Scrapy)
                            ↓
                 Playwright (for JS sites like MeroLagani)
                            ↓
                    Groq AI — Llama 3.3 70B
                            ↓
                      Notion API ✅
```

## Tech Stack

`Python Scrapy` · `Playwright` · `Groq AI (free)` · `Node.js MCP` · `Notion API` · `React` · `Docker` · `Railway`

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
which node                    # get your node path
# use the FULL path in claude_desktop_config.json "command" field
pkill -f Claude && open /Applications/Claude.app
```

**MCP not connecting:**
```bash
# Test manually
NOTION_TOKEN=xxx GROQ_API_KEY=xxx node notion-mcp/index.js
# Should print: [notion-mcp] ✅ Server running on stdio
```

---

*Built for MLH Global Hack Week — The Notion AI Challenge* 🏆