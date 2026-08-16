import { describe, expect, it } from "vitest";

import * as analysis from "./index";

describe("analysis 공개 인터페이스", () => {
  it("네 함수를 내보낸다", () => {
    expect(typeof analysis.summarize).toBe("function");
    expect(typeof analysis.computeFingerprint).toBe("function");
    expect(typeof analysis.bucketByClassification).toBe("function");
    expect(typeof analysis.pickSample).toBe("function");
  });
});
