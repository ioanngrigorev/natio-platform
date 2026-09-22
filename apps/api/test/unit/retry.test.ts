import { describe, expect, it } from "vitest";
import type { projects } from "../../src/db/schema/index.js";
import { resolveRetryPolicy, shouldRetry, type RetryPolicy } from "../../src/modules/payments/orchestrator.js";
import { isTestScenario, primitiveForAttempt, TEST_SCENARIOS } from "../../src/modules/payments/scenarios.js";

const policy = (over: Partial<RetryPolicy> = {}): RetryPolicy => ({ maxAttempts: 3, retryOnSoftDecline: true, retryOnTimeout: true, ...over });

describe("shouldRetry", () => {
  it("technical_error retries when candidates remain and attempts < max", () => {
    expect(shouldRetry("technical_error", policy(), 1, 2)).toEqual({ retry: true, reason: "technical_error_is_retryable" });
    expect(shouldRetry("technical_error", policy(), 2, 1)).toEqual({ retry: true, reason: "technical_error_is_retryable" });
  });

  it("provider_unavailable retries when candidates remain and attempts < max", () => {
    expect(shouldRetry("provider_unavailable", policy(), 1, 1)).toEqual({ retry: true, reason: "provider_unavailable_is_retryable" });
  });

  it("hard_decline is never retried", () => {
    expect(shouldRetry("hard_decline", policy(), 1, 5)).toEqual({ retry: false, reason: "hard_decline_never_retried" });
    expect(shouldRetry("hard_decline", policy({ maxAttempts: 5, retryOnSoftDecline: true, retryOnTimeout: true }), 1, 5).retry).toBe(false);
  });

  it("soft_decline depends on the policy", () => {
    expect(shouldRetry("soft_decline", policy({ retryOnSoftDecline: true }), 1, 1)).toEqual({ retry: true, reason: "soft_decline_cascade_enabled" });
    expect(shouldRetry("soft_decline", policy({ retryOnSoftDecline: false }), 1, 1)).toEqual({ retry: false, reason: "soft_decline_cascade_disabled" });
  });

  it("timeout retries only when the provider confirmed there is no charge and the policy allows it", () => {
    expect(shouldRetry("timeout", policy(), 1, 1, { timeoutResolvedSafe: true })).toEqual({ retry: true, reason: "provider_confirmed_no_charge" });
    expect(shouldRetry("timeout", policy(), 1, 1, { timeoutResolvedSafe: false })).toEqual({ retry: false, reason: "timeout_unresolved" });
    expect(shouldRetry("timeout", policy(), 1, 1)).toEqual({ retry: false, reason: "timeout_unresolved" });
    expect(shouldRetry("timeout", policy({ retryOnTimeout: false }), 1, 1, { timeoutResolvedSafe: true })).toEqual({ retry: false, reason: "timeout_retry_disabled" });
  });

  it("unknown outcome is never retried (possible double charge)", () => {
    expect(shouldRetry("unknown", policy(), 1, 3)).toEqual({ retry: false, reason: "outcome_unknown" });
  });

  it("success / requires_action are not retryable", () => {
    expect(shouldRetry("success", policy(), 1, 3)).toEqual({ retry: false, reason: "not_retryable" });
    expect(shouldRetry("requires_action", policy(), 1, 3)).toEqual({ retry: false, reason: "not_retryable" });
  });

  it("stops when max attempts is reached, whatever the outcome", () => {
    expect(shouldRetry("technical_error", policy({ maxAttempts: 2 }), 2, 3)).toEqual({ retry: false, reason: "max_attempts_reached" });
    expect(shouldRetry("provider_unavailable", policy({ maxAttempts: 1 }), 1, 3)).toEqual({ retry: false, reason: "max_attempts_reached" });
    expect(shouldRetry("soft_decline", policy({ maxAttempts: 3 }), 3, 3)).toEqual({ retry: false, reason: "max_attempts_reached" });
    expect(shouldRetry("timeout", policy({ maxAttempts: 3 }), 4, 3, { timeoutResolvedSafe: true })).toEqual({ retry: false, reason: "max_attempts_reached" });
  });

  it("stops when no candidates remain, and that check wins over max attempts", () => {
    expect(shouldRetry("technical_error", policy(), 1, 0)).toEqual({ retry: false, reason: "no_more_candidates" });
    expect(shouldRetry("technical_error", policy({ maxAttempts: 1 }), 1, 0)).toEqual({ retry: false, reason: "no_more_candidates" });
    expect(shouldRetry("hard_decline", policy(), 1, 0)).toEqual({ retry: false, reason: "no_more_candidates" });
    expect(shouldRetry("technical_error", policy(), 1, -1).retry).toBe(false);
  });

  it("matrix: every retryable outcome × remaining × attempts", () => {
    const outcomes = ["technical_error", "provider_unavailable", "soft_decline", "timeout"] as const;
    for (const outcome of outcomes) {
      for (let attempts = 1; attempts <= 4; attempts++) {
        for (let remaining = 0; remaining <= 2; remaining++) {
          const d = shouldRetry(outcome, policy({ maxAttempts: 3 }), attempts, remaining, { timeoutResolvedSafe: true });
          const expected = remaining > 0 && attempts < 3;
          expect(d.retry, `${outcome} attempts=${attempts} remaining=${remaining}`).toBe(expected);
        }
      }
    }
  });
});

describe("resolveRetryPolicy", () => {
  const project = (retryPolicy: NonNullable<(typeof projects.$inferSelect)["settings"]["retryPolicy"]> | undefined) =>
    ({ id: "prj", merchantId: "mer", name: "p", slug: "p", status: "active", settings: retryPolicy ? { retryPolicy } : {}, createdAt: new Date(), updatedAt: new Date() }) as unknown as typeof projects.$inferSelect;

  it("uses configuration defaults without a project", () => {
    const p = resolveRetryPolicy(null);
    expect(p.maxAttempts).toBe(3);
    expect(p.retryOnSoftDecline).toBe(true);
    expect(p.retryOnTimeout).toBe(true);
  });

  it("uses project overrides", () => {
    expect(resolveRetryPolicy(project({ maxAttempts: 2, retryOnSoftDecline: false, retryOnTimeout: false }))).toEqual({ maxAttempts: 2, retryOnSoftDecline: false, retryOnTimeout: false });
  });

  it("clamps maxAttempts to 1..5", () => {
    expect(resolveRetryPolicy(project({ maxAttempts: 10 })).maxAttempts).toBe(5);
    expect(resolveRetryPolicy(project({ maxAttempts: 0 })).maxAttempts).toBe(1);
    expect(resolveRetryPolicy(project({ maxAttempts: -3 })).maxAttempts).toBe(1);
  });

  it("falls back per field when the project only sets some values", () => {
    const p = resolveRetryPolicy(project({ retryOnSoftDecline: false }));
    expect(p).toEqual({ maxAttempts: 3, retryOnSoftDecline: false, retryOnTimeout: true });
    expect(resolveRetryPolicy(project(undefined))).toEqual({ maxAttempts: 3, retryOnSoftDecline: true, retryOnTimeout: true });
  });
});

describe("primitiveForAttempt", () => {
  it("returns undefined without a scenario or for unknown scenarios", () => {
    expect(primitiveForAttempt(null, 0)).toBeUndefined();
    expect(primitiveForAttempt(undefined, 0)).toBeUndefined();
    expect(primitiveForAttempt("", 0)).toBeUndefined();
    expect(primitiveForAttempt("review", 0)).toBeUndefined();
    expect(primitiveForAttempt("block", 0)).toBeUndefined();
    expect(primitiveForAttempt("not_a_scenario", 0)).toBeUndefined();
  });

  it("failover: technical_error on the first attempt, then success", () => {
    expect(primitiveForAttempt("failover", 0)).toBe("technical_error");
    expect(primitiveForAttempt("failover", 1)).toBe("success");
    expect(primitiveForAttempt("failover", 2)).toBe("success");
    expect(primitiveForAttempt("technical_error", 0)).toBe("technical_error");
    expect(primitiveForAttempt("technical_error", 1)).toBe("success");
  });

  it("timeout_recovered: timeout_created then success", () => {
    expect(primitiveForAttempt("timeout_recovered", 0)).toBe("timeout_created");
    expect(primitiveForAttempt("timeout_recovered", 1)).toBe("success");
  });

  it("timeout: timeout then success", () => {
    expect(primitiveForAttempt("timeout", 0)).toBe("timeout");
    expect(primitiveForAttempt("timeout", 1)).toBe("success");
  });

  it("unavailable: provider_unavailable then success", () => {
    expect(primitiveForAttempt("unavailable", 0)).toBe("provider_unavailable");
    expect(primitiveForAttempt("unavailable", 1)).toBe("success");
  });

  it("soft_decline: soft_decline then success", () => {
    expect(primitiveForAttempt("soft_decline", 0)).toBe("soft_decline");
    expect(primitiveForAttempt("soft_decline", 1)).toBe("success");
  });

  it("all_fail is always a technical error", () => {
    for (let i = 0; i < 5; i++) expect(primitiveForAttempt("all_fail", i)).toBe("technical_error");
  });

  it("constant scenarios map to their primitive on every attempt", () => {
    for (let i = 0; i < 3; i++) {
      expect(primitiveForAttempt("success", i)).toBe("success");
      expect(primitiveForAttempt("authorize", i)).toBe("authorize");
      expect(primitiveForAttempt("requires_action", i)).toBe("requires_action");
      expect(primitiveForAttempt("hard_decline", i)).toBe("hard_decline");
    }
  });

  it("isTestScenario recognises every documented scenario", () => {
    for (const name of Object.keys(TEST_SCENARIOS)) expect(isTestScenario(name)).toBe(true);
    expect(isTestScenario("nope")).toBe(false);
    expect(isTestScenario(42)).toBe(false);
    expect(isTestScenario(null)).toBe(false);
  });
});
