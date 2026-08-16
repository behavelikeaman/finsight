import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  AnthropicCtor: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: mocks.AnthropicCtor,
}));

import { getClient } from "./client";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mocks.AnthropicCtor.mockReset();
  mocks.AnthropicCtor.mockImplementation((opts: unknown) => ({ opts }));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getClient", () => {
  it("ANTHROPIC_API_KEY로 클라이언트를 만든다", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";

    getClient();

    expect(mocks.AnthropicCtor).toHaveBeenCalledWith({ apiKey: "sk-test-key" });
  });

  it("키가 없으면 호출 시점에 던진다(모듈 로드가 아니라)", () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => getClient()).toThrow();
  });
});
