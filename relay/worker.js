// Booth Log AI reader: a Cloudflare Worker that turns a drive of booth talk into snaps.
// The Anthropic key lives in this Worker's secret ANTHROPIC_API_KEY, never in the app or the chat.
// Paste this whole file into the Worker's code editor and deploy.

const MODEL = "claude-haiku-5-5";
const ALLOWED_ORIGINS = ["https://coachmattlemmon.github.io"];
const MAX_TEXT = 12000;          // characters of talk per request (a long drive is ~3,000)
const DAILY_LIMIT = 150;         // requests per device per day, on top of the spending cap set at Anthropic

const hits = new Map();          // per-device counts for this Worker instance (a soft limit; the spending cap is the hard one)

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const json = (body, status, origin) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });

const RULES = `You read a high school football coach's booth talk from phone dictation and split it into snaps.
The talk is live: play calls, reads, results, side conversation with the head coach, reactions to the refs. Most of it is not data.
Our offense is on the field. The defense is the opponent being charted.

How to find snaps:
- A snap usually starts with a down and distance ("2nd and 6", "first and 10 from the 30") and/or a play call. Coaches often say the call twice in a row ("yellow off glove X happy, yellow off glove X happy"); that is ONE snap.
- The result usually comes after the call: "+7", "plus 6", "minus 1", "touchdown", "incomplete", "first down", "holding", "sack".
- A new call after a result means a new snap. A down and distance said after a result usually belongs to the NEXT snap.
- Talk about what a different call could do ("you could go Vegas", "I'd get to yellow glove") is not a snap.
- Skip chatter, ref complaints and cheering.

Dictation mistakes to undo: "for two bucks/bikes/blocks" = "4-2 box"; "52 bucks" = "5-2 box"; "too high" = two-high; "first in 10" = "first and 10"; "first and 1025" = "first and 10 from the 25"; numbers may be run together. Use the coach's heard-as fixes below.

Use the coach's own words for formations, plays and tags (their list is below). A call like "flex right hot razer glove X glance" is formation Flex Right, play Glove, tags Hot, Razer, X Glance. When a call packages a run with a pass or screen ("stack grass vegas"), the run is the play and the rest are tags.

Reply with ONLY a JSON array, one object per snap in order, with exactly these keys (null when not said; never guess):
down (1-4), dist (yards to go; for "and goal" the yards to the goal line if known), side ("-" our side of the field, "+" their side), yd (yard line number),
hash ("L","M","R"), personnel (e.g. "11","20"), formation (as called, e.g. "Yellow", "Flex Right"), play, playType ("run","pass","rpo","screen","play-action","qb-run","other"), tags (array of strings),
box (defenders in the box as said: "4-2", "5-2", "7 in box", "Light", "Heavy"), front, coverage ("Cover 0","Cover 1","Cover 2","Cover 3","Cover 4","Cover 6","Man","Zone" or as said), rotation, pressure (number of rushers), blitz (true only if said), blitzer,
gain (yards, negative for a loss, 0 for incomplete), outcome ("td","int","fumble","sack","incomplete","penalty","first-down" or null),
defender (the opponent player/position a note is about, short: "Mike", "#13", "Boundary CB"), weakness (the coach's read on that defender, short, in their words),
note (any other read worth keeping for the scouting report, short), raw (the exact words from the talk that belong to this snap).`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "Booth Log reader. POST only." }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "Not allowed from this site." }, 403, origin);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "The reader isn't set up yet (no API key)." }, 500, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400, origin); }
    const text = String(body.text || "").slice(0, MAX_TEXT).trim();
    if (text.length < 3) return json({ plays: [] }, 200, origin);

    const device = String(body.device || request.headers.get("CF-Connecting-IP") || "anon").slice(0, 64);
    const day = new Date().toISOString().slice(0, 10), key = day + ":" + device;
    const n = (hits.get(key) || 0) + 1;
    if (n > DAILY_LIMIT) return json({ error: "Daily limit reached on this device. The free reader still works." }, 429, origin);
    hits.set(key, n);
    if (hits.size > 5000) hits.clear();

    const t = body.terms || {};
    const list = (o) => (o && typeof o === "object" ? Object.keys(o) : []).slice(0, 200).join(", ");
    const tags = Array.isArray(t.tags) ? t.tags.slice(0, 100).join(", ") : "";
    const alias = t.alias && typeof t.alias === "object" ? Object.entries(t.alias).slice(0, 100).map(([a, b]) => `"${a}" = "${b}"`).join(", ") : "";
    const prev = body.prev && typeof body.prev === "object" ? body.prev : null;
    const context =
      `Coach's formations: ${list(t.forms) || "(none given)"}\n` +
      `Coach's plays: ${list(t.plays) || "(none given)"}\n` +
      `Coach's tags and motions: ${tags || "(none given)"}\n` +
      `Heard-as fixes: ${alias || "(none)"}\n` +
      (prev ? `Situation before this talk: ${JSON.stringify({ down: prev.down ?? null, dist: prev.dist ?? null, side: prev.side ?? null, yd: prev.yd ?? null })}\n` : "") +
      (body.scout ? `This is scout film: the offense is another team, charted for the defense's tendencies.\n` : "");

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: RULES,
        messages: [{ role: "user", content: context + "\nBooth talk:\n\"\"\"\n" + text + "\n\"\"\"" }],
      }),
    });
    if (!r.ok) {
      const status = r.status === 429 || r.status === 529 ? 503 : 502;
      return json({ error: r.status === 400 || r.status === 401 || r.status === 403 ? "The reader's account needs attention (key or credit)." : "The reader is busy. Try again in a minute." }, status, origin);
    }
    const data = await r.json();
    const out = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    let plays = null;
    try { plays = JSON.parse(out); } catch {
      const a = out.indexOf("["), b = out.lastIndexOf("]");
      if (a >= 0 && b > a) { try { plays = JSON.parse(out.slice(a, b + 1)); } catch {} }
    }
    if (!Array.isArray(plays)) return json({ error: "The reader couldn't make sense of that drive." }, 502, origin);
    return json({ plays: plays.slice(0, 40) }, 200, origin);
  },
};
