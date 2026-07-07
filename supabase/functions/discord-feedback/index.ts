// Discord "Feedback & Support" bot for We Ride at Dawn (WRAD).
// Runs as a Supabase Edge Function acting as Discord's Interactions Endpoint.
// Storage is Discord-only: submissions are posted as embeds with a thread each.
import { verifyDiscordSignature } from "./verify.ts";

const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const DISCORD_PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
const CHANNEL_ID = Deno.env.get("CHANNEL_ID") ?? "1524165668004560896";

const DISCORD_API = "https://discord.com/api/v10";
// Discord's Cloudflare edge rejects requests without a proper bot User-Agent
// (returns Cloudflare error 1010), so send one explicitly on every REST call.
const USER_AGENT =
  "DiscordBot (https://github.com/JelleDenmark/we-ride-at-dawn, 1.0)";

function botHeaders(): Record<string, string> {
  return {
    "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
}

// Interaction types
const PING = 1;
const MESSAGE_COMPONENT = 3;
const MODAL_SUBMIT = 5;

// Interaction response types
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const MODAL = 9;

// Component types
const ACTION_ROW = 1;
const TEXT_INPUT = 4;
const TEXT_SHORT = 1;
const TEXT_PARAGRAPH = 2;

const EPHEMERAL = 64;

// ---- Modal builders -------------------------------------------------------

function textInputRow(
  customId: string,
  label: string,
  style: number,
  required: boolean,
) {
  return {
    type: ACTION_ROW,
    components: [
      {
        type: TEXT_INPUT,
        custom_id: customId,
        label,
        style,
        required,
      },
    ],
  };
}

function bugModal() {
  return {
    custom_id: "modal_bug",
    title: "Report a Bug",
    components: [
      textInputRow("bug_what", "What happened?", TEXT_PARAGRAPH, true),
      textInputRow(
        "bug_steps",
        "What were you doing / steps to reproduce",
        TEXT_PARAGRAPH,
        true,
      ),
      textInputRow(
        "bug_device",
        "Device / browser (optional)",
        TEXT_SHORT,
        false,
      ),
    ],
  };
}

function feedbackModal() {
  return {
    custom_id: "modal_feedback",
    title: "Feedback / Idea",
    components: [
      textInputRow("fb_text", "Your feedback or idea", TEXT_PARAGRAPH, true),
    ],
  };
}

function questionModal() {
  return {
    custom_id: "modal_question",
    title: "Ask a Question",
    components: [
      textInputRow("q_text", "Your question", TEXT_PARAGRAPH, true),
    ],
  };
}

// ---- Helpers --------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Read the submitted modal values into a { custom_id: value } map.
function extractModalValues(
  data: { components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }> },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of data.components ?? []) {
    const input = row.components?.[0];
    if (input?.custom_id != null) {
      out[input.custom_id] = (input.value ?? "").trim();
    }
  }
  return out;
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

// ---- Discord REST ---------------------------------------------------------

async function postMessage(embed: unknown): Promise<string | null> {
  const res = await fetch(`${DISCORD_API}/channels/${CHANNEL_ID}/messages`, {
    method: "POST",
    headers: botHeaders(),
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) {
    console.error("postMessage failed", res.status, await res.text());
    return null;
  }
  const msg = await res.json();
  return msg.id ?? null;
}

async function createThread(messageId: string, name: string): Promise<void> {
  try {
    const res = await fetch(
      `${DISCORD_API}/channels/${CHANNEL_ID}/messages/${messageId}/threads`,
      {
        method: "POST",
        headers: botHeaders(),
        body: JSON.stringify({ name, auto_archive_duration: 10080 }),
      },
    );
    if (!res.ok) {
      console.error("createThread failed", res.status, await res.text());
    }
  } catch (e) {
    console.error("createThread error", e);
  }
}

// ---- Embed construction ---------------------------------------------------

interface Submitter {
  name: string;
  id: string;
}

function getSubmitter(interaction: {
  member?: { user?: { username?: string; id?: string; global_name?: string } };
  user?: { username?: string; id?: string; global_name?: string };
}): Submitter {
  const u = interaction.member?.user ?? interaction.user ?? {};
  const name = u.global_name || u.username || "Unknown";
  return { name, id: u.id ?? "" };
}

type ReportType = "bug" | "feedback" | "question";

const TYPE_META: Record<
  ReportType,
  { color: number; title: string; label: string }
> = {
  bug: { color: 0xe74c3c, title: "🐛 Bug Report", label: "bug report" },
  feedback: { color: 0x3498db, title: "💬 Feedback", label: "feedback" },
  question: { color: 0xf1c40f, title: "❓ Question", label: "question" },
};

function buildEmbed(
  type: ReportType,
  values: Record<string, string>,
  submitter: Submitter,
) {
  const meta = TYPE_META[type];
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  let firstAnswer = "";

  if (type === "bug") {
    firstAnswer = values.bug_what ?? "";
    fields.push({
      name: "What happened",
      value: truncate(values.bug_what || "(none)", 1024),
    });
    fields.push({
      name: "Steps / context",
      value: truncate(values.bug_steps || "(none)", 1024),
    });
    if (values.bug_device) {
      fields.push({ name: "Device", value: truncate(values.bug_device, 1024) });
    }
  } else if (type === "feedback") {
    firstAnswer = values.fb_text ?? "";
    fields.push({
      name: "Feedback / Idea",
      value: truncate(values.fb_text || "(none)", 1024),
    });
  } else {
    firstAnswer = values.q_text ?? "";
    fields.push({
      name: "Question",
      value: truncate(values.q_text || "(none)", 1024),
    });
  }

  const embed = {
    color: meta.color,
    title: meta.title,
    fields,
    author: {
      name: submitter.name + (submitter.id ? ` (${submitter.id})` : ""),
    },
    timestamp: new Date().toISOString(),
  };

  return { embed, firstAnswer, label: meta.label, title: meta.title };
}

// ---- Main handler ---------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const signature = req.headers.get("X-Signature-Ed25519");
  const timestamp = req.headers.get("X-Signature-Timestamp");
  const rawBody = await req.text();

  // Verify the signature BEFORE any body-based branching.
  const valid = verifyDiscordSignature(
    rawBody,
    signature,
    timestamp,
    DISCORD_PUBLIC_KEY,
  );
  if (!valid) {
    return new Response("invalid request signature", { status: 401 });
  }

  let interaction: any;
  try {
    interaction = JSON.parse(rawBody);
  } catch (_e) {
    return new Response("bad request", { status: 400 });
  }

  const type = interaction.type;

  // PING -> PONG
  if (type === PING) {
    return json({ type: PONG });
  }

  // Button click -> open a modal
  if (type === MESSAGE_COMPONENT) {
    const customId = interaction.data?.custom_id;
    if (customId === "fb_bug") {
      return json({ type: MODAL, data: bugModal() });
    }
    if (customId === "fb_feedback") {
      return json({ type: MODAL, data: feedbackModal() });
    }
    if (customId === "fb_question") {
      return json({ type: MODAL, data: questionModal() });
    }
    return new Response("unknown component", { status: 400 });
  }

  // Modal submit -> post embed + thread, reply ephemerally
  if (type === MODAL_SUBMIT) {
    const modalId = interaction.data?.custom_id;
    let reportType: ReportType | null = null;
    if (modalId === "modal_bug") reportType = "bug";
    else if (modalId === "modal_feedback") reportType = "feedback";
    else if (modalId === "modal_question") reportType = "question";

    if (!reportType) {
      return new Response("unknown modal", { status: 400 });
    }

    const values = extractModalValues(interaction.data ?? {});
    const submitter = getSubmitter(interaction);
    const { embed, firstAnswer, label, title } = buildEmbed(
      reportType,
      values,
      submitter,
    );

    const messageId = await postMessage(embed);
    if (messageId) {
      const threadName = truncate(`${title}: ${firstAnswer}`, 90);
      await createThread(messageId, threadName);
    }

    return json({
      type: CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: EPHEMERAL,
        content:
          `✅ Thanks! Your ${label} was posted to the channel — watch the thread for replies.`,
      },
    });
  }

  return new Response("unsupported interaction type", { status: 400 });
});
