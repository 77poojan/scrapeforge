#!/usr/bin/env node
/**
 * ScrapeForge → Notion MCP Server
 * ================================
 * Calls your real backend (run.py / Express index.js) and pushes
 * structured results into Notion via the Model Context Protocol.
 *
 * Project layout expected:
 *
 *   scrapeforge-notion/
 *   ├── backend/
 *   │   ├── index.js                    ← Express API  (port 5050)
 *   │   ├── run.py                      ← Scrapy CLI runner
 *   │   └── scrapeforge_project/
 *   │       ├── settings.py
 *   │       ├── middlewares.py
 *   │       └── spiders/
 *   │           └── smart_spider.py
 *   ├── frontend/                        ← React app
 *   └── notion-mcp/
 *       └── index.js                    ← YOU ARE HERE
 *
 * Env vars (put in claude_desktop_config.json → env):
 *   NOTION_TOKEN          – Notion integration secret  (required)
 *   ANTHROPIC_API_KEY     – Claude API key             (required)
 *   SCRAPEFORGE_BACKEND   – http://localhost:5050  if Express is running (optional)
 *   SCRAPEFORGE_DIR       – absolute path to backend/  (auto-detected)
 *   PYTHON                – python binary (default: python3)
 *
 * MCP Tools:
 *   scrape_to_notion_page   full Scrapy pipeline  → Notion page
 *   scrape_quick_to_page    Express /api/scrape   → Notion page
 *   scrape_to_notion_db     Scrapy or quick       → Notion database row
 *   notion_create_page      plain text            → new Notion page
 *   notion_append_blocks    text                  → existing Notion page
 *   notion_query_db         query a database
 *   notion_get_page         retrieve a page
 */

import { Server }               from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client }    from "@notionhq/client";
import { JSDOM }     from "jsdom";
import { Readability } from "@mozilla/readability";
import axios         from "axios";
import { spawn }     from "child_process";
import { readFile, unlink } from "fs/promises";
import { existsSync }  from "fs";
import path          from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CONFIG ────────────────────────────────────────────────────────────────────

const NOTION_TOKEN        = process.env.NOTION_TOKEN        || "";
const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY   || "";
const SCRAPEFORGE_BACKEND = process.env.SCRAPEFORGE_BACKEND || "";
const SCRAPEFORGE_DIR     = process.env.SCRAPEFORGE_DIR
                            || path.resolve(__dirname, "..", "backend");
const PYTHON              = process.env.PYTHON || "python3";

if (!NOTION_TOKEN) {
  process.stderr.write("[notion-mcp] ERROR: NOTION_TOKEN is not set.\n");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// ── SCRAPEFORGE — FULL SCRAPY PIPELINE ────────────────────────────────────────
// Mirrors what your frontend's /api/scrape/deep endpoint does:
// spawns run.py → SmartSpider → PageAnalyzer → XPathGenerator →
// SelfHealingExtractor → structure_with_claude → JSON

async function deepScrape(url, query) {
  // Option A: delegate to your running Express server
  if (SCRAPEFORGE_BACKEND) {
    const res = await axios.post(
      `${SCRAPEFORGE_BACKEND}/api/scrape/deep`,
      { url, query },
      { timeout: 90000 }
    );
    return res.data;
  }

  // Option B: call run.py directly (same as what Express does in /api/scrape/deep)
  if (!existsSync(SCRAPEFORGE_DIR)) {
    throw new Error(
      `backend/ folder not found at ${SCRAPEFORGE_DIR}\n` +
      `Set SCRAPEFORGE_DIR to the absolute path of your backend/ folder.`
    );
  }

  const ts      = Date.now();
  const safe    = url.replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "page";
  const outFile = `mcp_output_${safe}_${ts}.json`;
  const outPath = path.join(SCRAPEFORGE_DIR, outFile);

  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [
      "run.py",
      "--url",   url,
      "--query", query || "Extract all main content, data, and key information",
      "--out",   outFile,
    ], {
      cwd: SCRAPEFORGE_DIR,
      env: { ...process.env },
    });

    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => reject(new Error(`run.py failed: ${err.message}`)));
    child.on("close", async (code) => {
      if (code !== 0)
        return reject(new Error(`run.py exited ${code}:\n${stderr.slice(0, 500)}`));
      try {
        const raw    = await readFile(outPath, "utf8");
        const parsed = JSON.parse(raw);
        parsed._source = "scrapy_smart_spider";
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Cannot read output: ${e.message}`));
      } finally {
        unlink(outPath).catch(() => {});
      }
    });
  });
}

// ── SCRAPEFORGE — QUICK SCRAPE ────────────────────────────────────────────────
// Mirrors your Express /api/scrape endpoint:
// axios fetch → cleanHtmlToTextAndLinks → callAnthropic → JSON

async function quickScrape(url, query) {
  if (SCRAPEFORGE_BACKEND) {
    const res = await axios.post(
      `${SCRAPEFORGE_BACKEND}/api/scrape`,
      { url, query },
      { timeout: 60000 }
    );
    return res.data;
  }

  // Inline — same logic as your index.js
  const html           = await fetchHtml(url);
  const cleanedContent = cleanHtmlToTextAndLinks(html, url);

  if (!ANTHROPIC_API_KEY) {
    return { ...freeExtractFromHtml(html, url), note: "ANTHROPIC_API_KEY not set; used free extractor" };
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `You are an expert web scraper. Extract what the user asks for. Return ONLY valid JSON:
{
  "success": true,
  "title": "page title",
  "extracted": { ...structured data... },
  "summary": "1-2 sentence summary",
  "itemCount": 0
}`,
      messages: [{
        role: "user",
        content: `URL: ${url}\nUSER REQUEST: ${query || "Extract all main content"}\n\nWEBSITE CONTENT:\n${cleanedContent}`,
      }],
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error?.message || "";
    if (/credit|insufficient|billing/i.test(msg))
      return { ...freeExtractFromHtml(html, url), note: "Credits low; used free extractor" };
    throw new Error(msg || `Anthropic HTTP ${resp.status}`);
  }

  const text = (data.content || []).map((b) => b?.text || "").join("").trim();
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { success: true, title: url, extracted: { raw: text }, summary: text.slice(0, 200), itemCount: 1 };
  }
}

// ── HTML HELPERS — mirrors your index.js exactly ──────────────────────────────

async function fetchHtml(url) {
  const res = await axios.get(url, {
    maxRedirects: 5, responseType: "text", timeout: 20000,
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`Fetch failed: HTTP ${res.status}`);
  return String(res.data || "");
}

function cleanHtmlToTextAndLinks(html, url) {
  const dom = new JSDOM(html, { url });
  const { document } = dom.window;
  ["script","style","noscript","iframe","svg"].forEach((tag) =>
    document.querySelectorAll(tag).forEach((el) => el.remove())
  );
  const title  = document.title || "";
  const text   = (document.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 8000);
  const metas  = Array.from(document.querySelectorAll("meta[content]")).slice(0, 10)
    .map((m) => m.getAttribute("content") || "").filter(Boolean);
  const links  = Array.from(document.querySelectorAll("a[href]")).slice(0, 50).map((a) => {
    const label = (a.textContent || "").trim();
    const href  = a.getAttribute("href") || "";
    let r = href;
    try { r = new URL(href, url).toString(); } catch {}
    return `[${label || r}](${r})`;
  });
  const images = Array.from(document.querySelectorAll("img[src]")).slice(0, 20).map((img) => {
    const alt = img.getAttribute("alt") || "";
    const src = img.getAttribute("src") || "";
    let r = src;
    try { r = new URL(src, url).toString(); } catch {}
    return `![${alt}](${r})`;
  });
  return `TITLE: ${title}\nMETA: ${metas.join(" | ")}\n\nTEXT CONTENT:\n${text}\n\nLINKS:\n${links.join("\n")}\n\nIMAGES:\n${images.join("\n")}`;
}

function freeExtractFromHtml(html, url) {
  const dom    = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const art    = reader.parse();
  const title  = art?.title || dom.window.document.title || url;
  const content = (art?.textContent || dom.window.document.body?.textContent || "")
    .replace(/\s+/g, " ").trim().slice(0, 12000);
  const headings = Array.from(dom.window.document.querySelectorAll("h1,h2,h3"))
    .slice(0, 50).map((h) => (h.textContent || "").trim()).filter(Boolean);
  const links = Array.from(dom.window.document.querySelectorAll("a[href]")).slice(0, 30).map((a) => {
    const label = (a.textContent || "").trim();
    const href = a.getAttribute("href") || "";
    let r = href;
    try { r = new URL(href, url).toString(); } catch {}
    return { text: label, href: r };
  });
  const images = Array.from(dom.window.document.querySelectorAll("img[src]")).slice(0, 30).map((img) => {
    const alt = img.getAttribute("alt") || "";
    const src = img.getAttribute("src") || "";
    let r = src;
    try { r = new URL(src, url).toString(); } catch {}
    return { alt, src: r };
  });
  return {
    success: true, title,
    extracted: { url, headings, content, links, images },
    summary: art?.excerpt || content.slice(0, 220),
    itemCount: headings.length || 1,
    model: "readability",
  };
}

// ── NOTION HELPERS ────────────────────────────────────────────────────────────

function richText(str) {
  if (!str) return [{ type: "text", text: { content: "" } }];
  const chunks = [];
  for (let i = 0; i < str.length; i += 2000)
    chunks.push({ type: "text", text: { content: str.slice(i, i + 2000) } });
  return chunks;
}
const para   = (t) => ({ object: "block", type: "paragraph",          paragraph:          { rich_text: richText(String(t).slice(0, 2000)) } });
const h2     = (t) => ({ object: "block", type: "heading_2",          heading_2:          { rich_text: richText(String(t).slice(0, 2000)) } });
const h3     = (t) => ({ object: "block", type: "heading_3",          heading_3:          { rich_text: richText(String(t).slice(0, 2000)) } });
const bullet = (t) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(String(t).slice(0, 2000)) } });
const callout = (t, emoji = "🕷️") => ({
  object: "block", type: "callout",
  callout: { rich_text: richText(String(t).slice(0, 2000)), icon: { type: "emoji", emoji } },
});
const code = (t) => ({
  object: "block", type: "code",
  code: { rich_text: richText(String(t).slice(0, 2000)), language: "json" },
});
const divider = () => ({ object: "block", type: "divider", divider: {} });

async function appendBlocks(pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 100)
    await notion.blocks.children.append({ block_id: pageId, children: blocks.slice(i, i + 100) });
}

/**
 * Convert ScrapeForge result → Notion blocks.
 * Handles SmartSpider output shape (data, _meta, item_count) and
 * quick-scrape shape (extracted, summary, itemCount).
 */
function toBlocks(result, url, query) {
  const blocks = [];

  // Header callout
  blocks.push(callout(`🔗 ${url}\n📋 Query: ${query || "general extraction"}`, "🕷️"));

  // Summary
  const summary = result.summary || result.data?.summary || "";
  if (summary) { blocks.push(h2("Summary")); blocks.push(para(summary)); }

  // SmartSpider metadata
  const meta = result._meta || {};
  if (meta.page_type) {
    blocks.push(para(
      `📄 Page type: ${meta.page_type}  |  ` +
      `Self-healed selectors: ${meta.healed_selectors ?? 0}  |  ` +
      `Scraped: ${meta.scraped_at ?? ""}`
    ));
  }
  blocks.push(divider());

  // Extracted content — handles both output shapes from your project
  const extracted = result.data || result.extracted || {};

  for (const [key, val] of Object.entries(extracted)) {
    if (!val) continue;
    const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    blocks.push(h3(label));

    if (typeof val === "string") {
      val.slice(0, 6000).match(/.{1,2000}/gs)?.forEach((chunk) => blocks.push(para(chunk)));
    } else if (Array.isArray(val)) {
      val.slice(0, 80).forEach((item) => {
        if (!item) return;
        blocks.push(bullet(typeof item === "object" ? JSON.stringify(item) : String(item)));
      });
    } else if (typeof val === "object") {
      const json = JSON.stringify(val, null, 2);
      json.length < 2000
        ? blocks.push(code(json))
        : Object.entries(val).slice(0, 20).forEach(([k, v]) =>
            blocks.push(bullet(`${k}: ${JSON.stringify(v).slice(0, 400)}`))
          );
    }
  }

  if (result.item_count != null || result.itemCount != null)
    blocks.push(para(`✅ Items extracted: ${result.item_count ?? result.itemCount}`));

  blocks.push(divider());
  return blocks;
}

// ── TOOL HANDLERS ─────────────────────────────────────────────────────────────

async function handleScrapeToPage({ url, query, parent_page_id, title }) {
  if (!url || !parent_page_id) throw new Error("url and parent_page_id are required");
  const result    = await deepScrape(url, query);
  const pageTitle = title || result.title || url;
  const blocks    = toBlocks(result, url, query);

  const page = await notion.pages.create({
    parent: { type: "page_id", page_id: parent_page_id },
    properties: { title: { title: richText(pageTitle.slice(0, 2000)) } },
    children: blocks.slice(0, 100),
  });
  if (blocks.length > 100) await appendBlocks(page.id, blocks.slice(100));

  return {
    page_id: page.id, page_url: page.url, title: pageTitle,
    summary: result.summary || "",
    item_count: result.item_count ?? result.itemCount ?? 0,
    page_type: result._meta?.page_type || "unknown",
    healed_selectors: result._meta?.healed_selectors ?? 0,
    source: result._source || "scrapy",
  };
}

async function handleQuickToPage({ url, query, parent_page_id, title }) {
  if (!url || !parent_page_id) throw new Error("url and parent_page_id are required");
  const result    = await quickScrape(url, query);
  const pageTitle = title || result.title || url;
  const blocks    = toBlocks(result, url, query);

  const page = await notion.pages.create({
    parent: { type: "page_id", page_id: parent_page_id },
    properties: { title: { title: richText(pageTitle.slice(0, 2000)) } },
    children: blocks.slice(0, 100),
  });
  if (blocks.length > 100) await appendBlocks(page.id, blocks.slice(100));

  return { page_id: page.id, page_url: page.url, title: pageTitle, summary: result.summary || "" };
}

async function handleScrapeToDb({ url, query, database_id, mode }) {
  if (!url || !database_id) throw new Error("url and database_id are required");
  const result  = mode === "quick" ? await quickScrape(url, query) : await deepScrape(url, query);
  const title   = result.title || url;
  const blocks  = toBlocks(result, url, query);

  // Auto-detect title property name from database schema
  const db       = await notion.databases.retrieve({ database_id });
  const titleKey = Object.entries(db.properties).find(([, v]) => v.type === "title")?.[0] || "Name";
  const urlKey   = Object.entries(db.properties).find(([, v]) => v.type === "url")?.[0];
  const summaryKey = Object.entries(db.properties)
    .find(([k, v]) => v.type === "rich_text" && /summary|desc|note/i.test(k))?.[0];

  const properties = { [titleKey]: { title: richText(title.slice(0, 2000)) } };
  if (urlKey) properties[urlKey] = { url };
  if (summaryKey && result.summary)
    properties[summaryKey] = { rich_text: richText(result.summary.slice(0, 2000)) };

  const page = await notion.pages.create({
    parent: { type: "database_id", database_id },
    properties,
    children: blocks.slice(0, 100),
  });
  if (blocks.length > 100) await appendBlocks(page.id, blocks.slice(100));

  return { page_id: page.id, page_url: page.url, title, summary: result.summary || "" };
}

async function handleCreatePage({ parent_page_id, title, content }) {
  if (!parent_page_id || !title) throw new Error("parent_page_id and title are required");
  const blocks = (content || "").split(/\n+/).filter(Boolean).slice(0, 200).map(para);
  const page = await notion.pages.create({
    parent: { type: "page_id", page_id: parent_page_id },
    properties: { title: { title: richText(title.slice(0, 2000)) } },
    children: blocks.slice(0, 100),
  });
  if (blocks.length > 100) await appendBlocks(page.id, blocks.slice(100));
  return { page_id: page.id, page_url: page.url };
}

async function handleAppendBlocks({ page_id, content }) {
  if (!page_id || !content) throw new Error("page_id and content are required");
  const blocks = content.split(/\n+/).filter(Boolean).slice(0, 200).map(para);
  await appendBlocks(page_id, blocks);
  return { appended_blocks: blocks.length };
}

async function handleQueryDb({ database_id, filter, page_size }) {
  if (!database_id) throw new Error("database_id is required");
  const params = { database_id, page_size: Math.min(page_size || 20, 100) };
  if (filter) params.filter = filter;
  const res  = await notion.databases.query(params);
  const rows = res.results.map((p) => {
    const props = {};
    for (const [k, v] of Object.entries(p.properties || {})) {
      if      (v.type === "title")      props[k] = v.title.map((t) => t.plain_text).join("");
      else if (v.type === "rich_text")  props[k] = v.rich_text.map((t) => t.plain_text).join("");
      else if (v.type === "url")        props[k] = v.url;
      else if (v.type === "number")     props[k] = v.number;
      else if (v.type === "select")     props[k] = v.select?.name;
      else if (v.type === "date")       props[k] = v.date?.start;
      else props[k] = JSON.stringify(v);
    }
    return { id: p.id, url: p.url, properties: props };
  });
  return { count: rows.length, rows };
}

async function handleGetPage({ page_id }) {
  if (!page_id) throw new Error("page_id is required");
  const page   = await notion.pages.retrieve({ page_id });
  const blocks = await notion.blocks.children.list({ block_id: page_id, page_size: 50 });
  const text   = blocks.results.map((b) => {
    const inner = b[b.type];
    return (inner?.rich_text || []).map((r) => r.plain_text).join("");
  }).join("\n");
  return {
    page_id: page.id, page_url: page.url,
    title: page.properties?.title?.title?.map((t) => t.plain_text).join("") ||
           page.properties?.Name?.title?.map((t) => t.plain_text).join("") || "",
    content_preview: text.slice(0, 3000),
  };
}

// ── MCP SERVER ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "notion-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "scrape_to_notion_page",
      description: "Full ScrapeForge pipeline: run.py → SmartSpider (PageAnalyzer + XPathGenerator + SelfHealingExtractor + Claude AI) → Notion page. Best for complex, data-heavy pages.",
      inputSchema: {
        type: "object",
        properties: {
          url:            { type: "string", description: "URL to scrape" },
          query:          { type: "string", description: "What to extract (natural language)" },
          parent_page_id: { type: "string", description: "Notion parent page ID" },
          title:          { type: "string", description: "Override page title (optional)" },
        },
        required: ["url", "parent_page_id"],
      },
    },
    {
      name: "scrape_quick_to_page",
      description: "Lightweight scrape: axios fetch + Claude AI (mirrors Express /api/scrape) → Notion page. Faster, good for articles and simple pages.",
      inputSchema: {
        type: "object",
        properties: {
          url:            { type: "string", description: "URL to scrape" },
          query:          { type: "string", description: "What to extract" },
          parent_page_id: { type: "string", description: "Notion parent page ID" },
          title:          { type: "string", description: "Override page title (optional)" },
        },
        required: ["url", "parent_page_id"],
      },
    },
    {
      name: "scrape_to_notion_db",
      description: "Scrape a URL and append a row to a Notion database. Auto-detects title/URL/summary columns. Use mode='quick' for fast scrape or mode='full' for Scrapy pipeline.",
      inputSchema: {
        type: "object",
        properties: {
          url:         { type: "string", description: "URL to scrape" },
          query:       { type: "string", description: "What to extract" },
          database_id: { type: "string", description: "Notion database ID" },
          mode:        { type: "string", enum: ["full", "quick"], description: "full=Scrapy, quick=Express fetch (default: full)" },
        },
        required: ["url", "database_id"],
      },
    },
    {
      name: "notion_create_page",
      description: "Create a new Notion page with plain-text content under a parent page.",
      inputSchema: {
        type: "object",
        properties: {
          parent_page_id: { type: "string", description: "Parent page ID" },
          title:          { type: "string", description: "Page title" },
          content:        { type: "string", description: "Page body text" },
        },
        required: ["parent_page_id", "title"],
      },
    },
    {
      name: "notion_append_blocks",
      description: "Append text content to an existing Notion page.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID" },
          content: { type: "string", description: "Text to append" },
        },
        required: ["page_id", "content"],
      },
    },
    {
      name: "notion_query_db",
      description: "Query a Notion database and return rows with all properties.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID" },
          filter:      { type: "object", description: "Notion API filter object (optional)" },
          page_size:   { type: "number", description: "Max rows (default 20)" },
        },
        required: ["database_id"],
      },
    },
    {
      name: "notion_get_page",
      description: "Retrieve a Notion page and preview its content.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID" },
        },
        required: ["page_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result;
    switch (name) {
      case "scrape_to_notion_page":  result = await handleScrapeToPage(args);  break;
      case "scrape_quick_to_page":   result = await handleQuickToPage(args);   break;
      case "scrape_to_notion_db":    result = await handleScrapeToDb(args);    break;
      case "notion_create_page":     result = await handleCreatePage(args);    break;
      case "notion_append_blocks":   result = await handleAppendBlocks(args);  break;
      case "notion_query_db":        result = await handleQueryDb(args);       break;
      case "notion_get_page":        result = await handleGetPage(args);       break;
      case "research_assistant":   result = await handleResearchAssistant(args); break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[notion-mcp] ✅ Server running on stdio\n");
