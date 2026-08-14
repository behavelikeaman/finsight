import { describe, it, expect, afterEach } from "vitest";
import { serverEnv } from "./env";

const KEY = "ANTHROPIC_API_KEY";

afterEach(() => {
  delete process.env[KEY];
});

describe("serverEnv", () => {
  it("키가 있으면 값을 반환한다", () => {
    process.env[KEY] = "sk-test-123";
    expect(serverEnv(KEY)).toBe("sk-test-123");
  });

  it("키가 없으면 키 이름을 담은 메시지와 함께 throw한다", () => {
    delete process.env[KEY];
    expect(() => serverEnv(KEY)).toThrowError(new RegExp(KEY));
  });

  it("빈 문자열은 없는 것으로 취급해 throw한다", () => {
    process.env[KEY] = "";
    expect(() => serverEnv(KEY)).toThrow();
  });

  it("공백만 있는 값도 없는 것으로 취급해 throw한다", () => {
    process.env[KEY] = "   ";
    expect(() => serverEnv(KEY)).toThrow();
  });

  it("모듈 로드 시점이 아니라 호출 시점에 읽는다", () => {
    // import는 이미 끝났다. 지금 넣은 값이 보여야 호출 시점 조회다.
    process.env[KEY] = "set-after-import";
    expect(serverEnv(KEY)).toBe("set-after-import");
  });

  it(".env.example의 서버 전용 키를 모두 받는다", () => {
    const keys = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "ANTHROPIC_API_KEY",
      "POLAR_ACCESS_TOKEN",
      "POLAR_WEBHOOK_SECRET",
      "POLAR_PRO_PRODUCT_ID",
      "POLAR_SERVER",
    ] as const;

    for (const k of keys) {
      process.env[k] = `value-${k}`;
      expect(serverEnv(k)).toBe(`value-${k}`);
      delete process.env[k];
    }
  });
});
