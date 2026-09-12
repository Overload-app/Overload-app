import { describe, test, expect } from "vitest";
import { bearerToken, buildUpstreamBody, MODEL, MAX_OUTPUT_TOKENS } from "./claude.js";

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
