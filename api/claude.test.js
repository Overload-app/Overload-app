import { describe, test, expect } from "vitest";
import { bearerToken, buildUpstreamBody, MODEL, MAX_OUTPUT_TOKENS, requestTooLarge, overRateLimit, RATE_LIMIT, RATE_WINDOW_MS } from "./claude.js";

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
