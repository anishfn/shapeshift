import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { classifyWithJev, looksLikeKey, resolveBaseURL } = await import("@/lib/jev/client");

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TYPESAFE_API_KEY;
const originalBaseUrl = process.env.TYPESAFE_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.TYPESAFE_BASE_URL;
  else process.env.TYPESAFE_BASE_URL = originalBaseUrl;
});

describe("API key detection", () => {
  test("empty or missing → offline", () => {
    expect(looksLikeKey(undefined)).toBe(false);
    expect(looksLikeKey("")).toBe(false);
    expect(looksLikeKey("   ")).toBe(false);
  });
  test("copied placeholders → offline", () => {
    expect(looksLikeKey("sk-...")).toBe(false);
    expect(looksLikeKey("your-api-key-here")).toBe(false);
    expect(looksLikeKey("<TYPESAFE_API_KEY>")).toBe(false);
  });
  test("a real-looking key → online", () => {
    expect(looksLikeKey("sk-live-8f2c1a9b7d6e5f40")).toBe(true);
  });
});

describe("Jev-compatible endpoint URL validation", () => {
  test("keeps the hosted API default when unset or blank", () => {
    expect(resolveBaseURL(undefined)).toBeUndefined();
    expect(resolveBaseURL("  ")).toBeUndefined();
  });

  test("accepts HTTPS endpoints and HTTP loopback servers", () => {
    expect(resolveBaseURL("https://laya.example.com/api/")).toBe("https://laya.example.com/api/");
    expect(resolveBaseURL("http://localhost:8000")).toBe("http://localhost:8000");
    expect(resolveBaseURL("http://127.4.5.6:8000")).toBe("http://127.4.5.6:8000");
    expect(resolveBaseURL("http://[::1]:8000")).toBe("http://[::1]:8000");
  });

  test("rejects non-loopback HTTP and non-HTTP protocols", () => {
    expect(() => resolveBaseURL("http://laya.example.com")).toThrow("must use HTTPS");
    expect(() => resolveBaseURL("http://192.168.1.8:8000")).toThrow("must use HTTPS");
    expect(() => resolveBaseURL("ftp://laya.example.com")).toThrow("must use HTTPS");
    expect(() => resolveBaseURL("not a URL")).toThrow("absolute HTTP or HTTPS URL");
  });
});

describe("Jev-compatible endpoint configuration", () => {
  test("sends the normal System One request to the configured API root", async () => {
    process.env.TYPESAFE_API_KEY = "local-shapeshift-development-token";
    process.env.TYPESAFE_BASE_URL = "http://127.0.0.1:8000/";

    let requestUrl = "";
    let authorization = "";
    let redirectMode: RequestRedirect | undefined;
    let requestBody: {
      model?: string;
      state?: unknown;
      questions?: Record<string, { type: string; criteria?: unknown }>;
    } = {};
    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      redirectMode = init?.redirect;
      requestBody = JSON.parse(String(init?.body));

      const answers = Object.fromEntries(
        Object.entries(requestBody.questions ?? {}).map(([key, question]) => {
          if (question.type === "choice") {
            const labels = Object.keys(question.criteria as Record<string, unknown>);
            const selected = labels[0];
            return [
              key,
              {
                type: "choice",
                choice: selected,
                confidence: 1,
                probabilities: Object.fromEntries(labels.map((label) => [label, label === selected ? 1 : 0])),
              },
            ];
          }
          if (question.type === "score") {
            const levels = question.criteria as string[];
            return [
              key,
              {
                type: "score",
                score: 0,
                confidence: 1,
                legend: Object.fromEntries(levels.map((level, index) => [index, level])),
                probabilities: Object.fromEntries(levels.map((_, index) => [index, index === 0 ? 1 : 0])),
              },
            ];
          }
          return [key, { type: "noul", noul: 0 }];
        }),
      );

      return Response.json({ model: "jev-compatible-test", answers, usage: { input_tokens: 1, output_tokens: 0 } });
    };
    globalThis.fetch = fakeFetch as typeof fetch;

    const result = await classifyWithJev("buy milk and eggs");

    expect(requestUrl).toBe("http://127.0.0.1:8000/v1/systemone");
    expect(authorization).toBe("Bearer local-shapeshift-development-token");
    expect(redirectMode).toBe("error");
    expect(requestBody.model).toBe("jev-latest");
    expect(requestBody.state).toEqual({ text: "buy milk and eggs" });
    expect(Object.keys(requestBody.questions ?? {})).toHaveLength(14);
    expect(result.source).toBe("jev");
    expect(result.model).toBe("jev-compatible-test");
  });
});
