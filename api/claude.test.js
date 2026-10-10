import { describe, test, expect } from "vitest";
import { bearerToken, buildUpstreamBody, MODEL, MAX_OUTPUT_TOKENS, requestTooLarge, overRateLimit, RATE_LIMIT, RATE_WINDOW_MS, usageCostCents, overTrialCap } from "./claude.js";

// This endpoint's address is visible in the app's public JS bundle, so before
// these gates anyone could have used the project's Anthropic account as a free
// Claude proxy — and, because the body was forwarded verbatim, on a far
// pricier model than the app itself uses.
describe("bearerToken", () => {
  test("reads a normal Authorization header", () => {
    expect(bearerToken({ headers: { authorization: "Bearer abc.def.ghi" } })).toBe("abc.def.ghi");
  });

  test("is case-insensitive about the scheme and the header name", () => {
    expect(bearerToken({ headers: { Authorization: "bearer tok" } })).toBe("tok");
  });

  test("returns null when there is no usable token", () => {
    expect(bearerToken({ headers: {} })).toBeNull();
    expect(bearerToken({ headers: { authorization: "" } })).toBeNull();
    expect(bearerToken({ headers: { authorization: "Basic abc" } })).toBeNull();
    expect(bearerToken({})).toBeNull();
  });
});

describe("buildUpstreamBody", () => {
  test("pins the model, ignoring a caller asking for a pricier one", () => {
    expect(buildUpstreamBody({ model: "claude-opus-5" }).model).toBe(MODEL);
    expect(buildUpstreamBody({ model: "claude-fable-5-1" }).model).toBe(MODEL);
  });

  test("clamps an oversized max_tokens down to this app's ceiling", () => {
    expect(buildUpstreamBody({ max_tokens: 200000 }).max_tokens).toBe(MAX_OUTPUT_TOKENS);
  });

  test("leaves a smaller max_tokens alone — callers asking for less is fine", () => {
    expect(buildUpstreamBody({ max_tokens: 300 }).max_tokens).toBe(300);
  });

  test("falls back to the ceiling when max_tokens is missing or nonsense", () => {
    expect(buildUpstreamBody({}).max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(buildUpstreamBody({ max_tokens: "lots" }).max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(buildUpstreamBody({ max_tokens: -5 }).max_tokens).toBe(MAX_OUTPUT_TOKENS);
  });

  test("passes through everything the app legitimately sends", () => {
    const body = buildUpstreamBody({
      system: [{ type: "text", text: "rules" }],
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "respond", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: "respond" },
      output_config: { effort: "low" },
    });
    expect(body.system).toEqual([{ type: "text", text: "rules" }]);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.tools[0].name).toBe("respond");
    expect(body.tool_choice).toEqual({ type: "tool", name: "respond" });
    expect(body.output_config).toEqual({ effort: "low" });
  });

  test("drops anything else an untrusted caller tries to smuggle through", () => {
    const body = buildUpstreamBody({ messages: [], metadata: { user_id: "x" }, container: "c", betas: ["b"] });
    expect(body.metadata).toBeUndefined();
    expect(body.container).toBeUndefined();
    expect(body.betas).toBeUndefined();
  });

  test("survives a junk body without throwing", () => {
    expect(buildUpstreamBody(null).model).toBe(MODEL);
    expect(buildUpstreamBody("nope").model).toBe(MODEL);
  });
});

// Showing replies as they're written: the server streams only when the app
// literally asks, and otherwise behaves exactly as before.
describe("streaming", () => {
  test("only a literal stream:true is passed on", () => {
    expect(buildUpstreamBody({ stream: true }).stream).toBe(true);
    expect(buildUpstreamBody({ stream: "true" }).stream).toBeUndefined();
    expect(buildUpstreamBody({}).stream).toBeUndefined();
  });

  test("events are passed straight through, in order, then the response ends", async () => {
    const { pipeEventStream } = await import("./claude.js");
    const chunks = ["event: a\ndata: {\"x\":1}\n\n", "event: b\ndata: {\"x\":2}\n\n"].map((t) => new TextEncoder().encode(t));
    const body = new ReadableStream({ start(c) { chunks.forEach((ch) => c.enqueue(ch)); c.close(); } });
    const written = [];
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, write(b) { written.push(Buffer.from(b).toString()); }, end() { this.ended = true; } };
    await pipeEventStream(body, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toMatch(/text\/event-stream/);
    expect(written.join("")).toBe("event: a\ndata: {\"x\":1}\n\nevent: b\ndata: {\"x\":2}\n\n");
    expect(res.ended).toBe(true);
  });
});

describe("requestTooLarge", () => {
  test("a normal Coach request and a meal photo are fine", () => {
    const coach = { system: "x".repeat(60000), messages: Array.from({ length: 30 }, () => ({ role: "user", content: "y".repeat(500) })) };
    expect(requestTooLarge(coach)).toBe(false);
    const photo = { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "a".repeat(200000) } }, { type: "text", text: "what is this" }] }] };
    expect(requestTooLarge(photo)).toBe(false);
  });
  test("a pasted wall of text or a giant image is refused", () => {
    expect(requestTooLarge({ messages: [{ role: "user", content: "z".repeat(400000) }] })).toBe(true);
    expect(requestTooLarge({ messages: [{ role: "user", content: [{ type: "image", source: { data: "a".repeat(2000000) } }] }] })).toBe(true);
  });
  test("nothing at all is fine", () => {
    expect(requestTooLarge(undefined)).toBe(false);
  });
});

describe("overRateLimit", () => {
  test("lets normal use through, stops a loop, and recovers after the window", () => {
    const calls = new Map();
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT; i++) expect(overRateLimit("u", t0 + i * 1000, calls)).toBe(false);
    expect(overRateLimit("u", t0 + RATE_LIMIT * 1000, calls)).toBe(true);
    expect(overRateLimit("someone-else", t0, calls)).toBe(false);
    expect(overRateLimit("u", t0 + RATE_WINDOW_MS + RATE_LIMIT * 1000, calls)).toBe(false);
  });
});

describe("free-trial AI spending cap", () => {
  test("cost matches the app's own arithmetic", () => {
    // 1,000 fresh input + 10,000 cache read + 500 out = 0.2c + 0.2c + 0.5c
    expect(usageCostCents({ input_tokens: 1000, cache_read_input_tokens: 10000, output_tokens: 500 })).toBeCloseTo(0.9, 5);
    // a 1-hour cache write costs double
    expect(usageCostCents({ cache_creation_input_tokens: 10000 })).toBeCloseTo(4, 5);
    expect(usageCostCents(null)).toBe(0);
  });
  test("over 15c today or 75c this month is over the cap", () => {
    expect(overTrialCap([{ day: "2026-10-10", cents: 14.9 }], "2026-10-10")).toBe(false);
    expect(overTrialCap([{ day: "2026-10-10", cents: 15 }], "2026-10-10")).toBe(true);
    const month = Array.from({ length: 6 }, (_, i) => ({ day: `2026-10-0${i + 1}`, cents: 13 }));
    expect(overTrialCap(month, "2026-10-10")).toBe(true);
    expect(overTrialCap([{ day: "2026-09-30", cents: 74 }], "2026-10-10")).toBe(false);
    expect(overTrialCap([], "2026-10-10")).toBe(false);
  });
  test("a streamed reply's token counts are read as it passes through", async () => {
    const { pipeEventStream } = await import("./claude.js");
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 1200, cache_read_input_tokens: 9000, output_tokens: 1 } } },
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } },
      { type: "message_delta", usage: { output_tokens: 300 } },
    ];
    const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 17) c.enqueue(bytes.slice(i, i + 17)); c.close(); } });
    const written = [];
    const res = { setHeader() {}, write(b) { written.push(Buffer.from(b).toString()); }, end() {} };
    const usage = await pipeEventStream(body, res);
    expect(written.join("")).toBe(text);
    expect(usage).toMatchObject({ input_tokens: 1200, cache_read_input_tokens: 9000, output_tokens: 300 });
  });
});
