import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { groqComplete, RateLimitedError } from "@/lib/server/promote/groqCall";
import { ServerConfigError } from "@/lib/server/supabaseServer";
import { acceptExtractedIntent, hasEmailAddress } from "@/lib/server/assistant/actionIntent";
import { acceptExtractedPlace } from "@/lib/server/assistant/fileIntent";
import { ASSISTANT_MAX_REQUESTS, ASSISTANT_WINDOW_MS, clientIp, createRateLimiter } from "@/lib/server/rateLimit";

// POST /api/assistant/extract-action — for an add-member request the strict parser
// (lib/server/assistant/actionIntent.ts) didn't recognise: one small model call that
// EXTRACTS {email, target_name, target_type} from the person's own typed message.
// Same idiom as app/api/project-chat (groqComplete, sign-in first, fail closed).
//
// THE MODEL ONLY EXTRACTS. It gets the one message and nothing else: no ids, no
// teams, no projects, no other text. Its answer is then checked in code
// (acceptExtractedIntent): the email and the target name must both appear in the
// message, or the answer is { intent: null } and the panel treats the message as a
// normal research question. Finding the team or project, and adding anyone, happen
// elsewhere, as the person, after they press Confirm.

export const maxDuration = 15;

const MAX_BODY_BYTES = 2_000;
const MAX_MESSAGE_CHARS = 500; // the panel's input box limit
const limiter = createRateLimiter(ASSISTANT_WINDOW_MS, ASSISTANT_MAX_REQUESTS);

const SYSTEM = [
  "You read one message a researcher typed into an assistant and extract an add-a-person request, if there is one.",
  "It can be worded any way, formally or not: add, invite, put, get, bring, let someone into or onto a team or project, often with a reason.",
  'Reply with JSON only: {"email": string|null, "target_name": string|null, "target_type": "team"|"project"|null}.',
  "email: the email address of the person to add, copied exactly from the message.",
  "target_name: the name of the team or project they should be added to, copied exactly as written in the message, without words like 'the', 'my', 'team' or 'project'. A code such as C-103 is a name.",
  'target_type: "team" or "project" if the message says which, else null.',
  'If the message is not a request to add, invite or put a person into a team or project, reply {"email": null, "target_name": null, "target_type": null}.',
  "Never invent an email or a name that is not in the message.",
].join("\n");

// mode "file": a file is attached to the message. The model never sees the file or
// anything about it, only the typed text, and returns only the place's name and type.
const FILE_SYSTEM = [
  "A researcher attached a file in an assistant and typed one message about where it should go. You do not see the file.",
  "Extract the place they name: a community, a team or a project. A code such as C-103 is a project name.",
  'Reply with JSON only: {"target_name": string|null, "target_type": "community"|"team"|"project"|null}.',
  "target_name: copied exactly as written in the message, without words like 'the', 'my', 'community', 'team' or 'project'.",
  'target_type: only if the message says which, else null.',
  'If the message names no place, reply {"target_name": null, "target_type": null}. Never invent a name that is not in the message.',
].join("\n");

export async function POST(req: Request) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  }
  if (limiter.limited(clientIp(req))) {
    return NextResponse.json({ error: "Too many messages. Please wait a few minutes." }, { status: 429 });
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request too large." }, { status: 413 });

  let message = "";
  let mode: "member" | "file" = "member";
  try {
    const body = JSON.parse(text) as { message?: unknown; mode?: unknown };
    message = typeof body.message === "string" ? body.message.trim() : "";
    if (body.mode === "file") mode = "file";
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!message || message.length > MAX_MESSAGE_CHARS) return NextResponse.json({ intent: null });
  if (mode === "file") return extractPlace(message);
  // Only messages with an email address come here; the model decides whether it is
  // an add request at all.
  if (!hasEmailAddress(message)) return NextResponse.json({ intent: null });

  try {
    const raw = await groqComplete({
      system: SYSTEM,
      user: `Message: ${JSON.stringify(message)}\nReply in json.`,
      maxTokens: 300,
      temperature: 0,
      label: "assistant-extract-action",
      json: true,
    });
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    return NextResponse.json({ intent: acceptExtractedIntent(parsed, message) });
  } catch (e) {
    if (e instanceof RateLimitedError) return NextResponse.json({ intent: null, error: e.message }, { status: 503 });
    if (e instanceof ServerConfigError) console.error("extract-action: model not configured", e);
    else console.error("extract-action: model call failed", e);
    // Fail closed: no card; the message goes on as a normal question.
    return NextResponse.json({ intent: null });
  }
}

/** A file request the strict parser didn't read: the place's name and type, or no
 *  place. acceptExtractedPlace keeps a name only if the message contains it. */
async function extractPlace(message: string) {
  try {
    const raw = await groqComplete({
      system: FILE_SYSTEM,
      user: `Message: ${JSON.stringify(message)}\nReply in json.`,
      maxTokens: 200,
      temperature: 0,
      label: "assistant-extract-place",
      json: true,
    });
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    return NextResponse.json({ intent: acceptExtractedPlace(parsed, message) });
  } catch (e) {
    if (e instanceof RateLimitedError) return NextResponse.json({ intent: null, error: e.message }, { status: 503 });
    console.error("extract-action (file): model call failed", e);
    // No name: the person picks from their places.
    return NextResponse.json({ intent: null });
  }
}
