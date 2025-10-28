import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());

const PORT = Number(process.env.PORT || 4001);
const MCP_URL = process.env.MCP_URL!;
if (!MCP_URL) {
  console.error("Set MCP_URL in .env");
  process.exit(1);
}

async function mcpCall(method: string, params: any) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}`);
  return res.json();
}

function unwrap(result: any) {
  if (result?.result?.content) return result.result;
  return result; // fallback
}

app.post("/chatkit", async (req, res) => {
  try {
    const payload = req.body || {};
    const type: string = payload?.type;
    const text: string = payload?.text || "";
    const action: string | undefined = payload?.action;
    const parameters: Record<string, any> = payload?.parameters || {};

    if (type === "action") {
      if (action === "get_notes") {
        const args = {
          query: parameters.query ?? undefined,
          tag: parameters.tag ?? undefined,
          limit: Number(parameters.limit ?? 10)
        };
        const out = await mcpCall("tools/call", {
          name: "get_notes",
          arguments: args
        });
        return res.json(unwrap(out));
      }

      if (action === "create_note") {
        const args = {
          title: String(parameters.title || "").trim(),
          content: String(parameters.content || "").trim(),
          tags: Array.isArray(parameters.tags) ? parameters.tags : []
        };
        const out = await mcpCall("tools/call", {
          name: "create_note",
          arguments: args
        });
        return res.json(unwrap(out));
      }

      if (action === "note_action") {
        const args = {
          id: String(parameters.id || "").trim(),
          action: String(parameters.action || "").trim()
        };
        const out = await mcpCall("tools/call", {
          name: "note_action",
          arguments: args
        });
        return res.json(unwrap(out));
      }
    }

    const lower = text.toLowerCase();

    if (lower.startsWith("list notes") || lower.startsWith("show notes")) {
      const tagMatch = lower.match(/tag\s+([#\w-]+)/);
      const queryMatch = text.match(/query\s+(.+?)(?:\s+limit|\s+tag|$)/i);
      const limitMatch = lower.match(/limit\s+(\d{1,2})/);

      const args: any = {};
      if (tagMatch) args.tag = tagMatch[1].replace(/^#/, "");
      if (queryMatch) args.query = queryMatch[1].trim();
      if (limitMatch) args.limit = Number(limitMatch[1]);
      if (!args.limit) args.limit = 10;

      const out = await mcpCall("tools/call", {
        name: "get_notes",
        arguments: args
      });
      return res.json(unwrap(out));
    }

    if (lower.startsWith("create note")) {
      const quoted = [...text.matchAll(/"([^"]+)"/g)].map(m => m[1]);
      const title = quoted[0] || "Untitled";
      const content = quoted[1] || "";
      const tagMatches = [...text.matchAll(/#([A-Za-z0-9_-]+)/g)].map(m => m[1]);

      const out = await mcpCall("tools/call", {
        name: "create_note",
        arguments: { title, content, tags: tagMatches }
      });
      return res.json(unwrap(out));
    }

    {
      const m = lower.match(/\bview note\s+([A-Za-z0-9_-]+)/);
      if (m) {
        const id = m[1];
        const out = await mcpCall("tools/call", {
          name: "note_action",
          arguments: { id, action: "view" }
        });
        return res.json(unwrap(out));
      }
    }

    {
      const m = lower.match(/\bdelete note\s+([A-Za-z0-9_-]+)/);
      if (m) {
        const id = m[1];
        const out = await mcpCall("tools/call", {
          name: "note_action",
          arguments: { id, action: "delete" }
        });
        return res.json(unwrap(out));
      }
    }

    const out = await mcpCall("tools/call", {
      name: "get_notes",
      arguments: { limit: 6 }
    });
    return res.json(unwrap(out));
  } catch (err: any) {
    console.error("/chatkit error", err);
    return res.status(200).json({
      content: [
        {
          type: "text",
          text:
            "Sorry, I couldn't reach Auxee Notes. Try again in a moment, or check the MCP_URL tunnel."
        }
      ]
    });
  }
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "chatkit-adapter",
    path: "/chatkit",
    method: "POST",
    expects: {
      message_examples: [
        'list notes',
        'list notes tag todo limit 5',
        'create note "Standup" "Yesterday A… Today B…" #daily #team',
        'view note n123',
        'delete note n123'
      ]
    }
  });
});
app.get("/ping", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () =>
  console.log(`ChatKit adapter running on http://localhost:${PORT}`)
);

