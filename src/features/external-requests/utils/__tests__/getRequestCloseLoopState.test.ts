import { describe, it, expect } from "vitest";
import { getRequestCloseLoopState } from "../getRequestCloseLoopState";
import { PRICING_CRITICAL_KEYS } from "../../constants";

// Pick one real pricing-critical key from the shared constant
const pricingKey = [...PRICING_CRITICAL_KEYS][0]; // "cargo.freight_cost"

describe("getRequestCloseLoopState", () => {
  it("closed request → already_closed", () => {
    const result = getRequestCloseLoopState("closed", [], false);
    expect(result.state).toBe("already_closed");
    expect(result.remainingProposedCount).toBe(0);
  });

  it("no facts, not closed → in_progress", () => {
    const result = getRequestCloseLoopState("sent", [], false);
    expect(result.state).toBe("in_progress");
    expect(result.remainingProposedCount).toBe(0);
  });

  it("proposed facts present → awaiting_validation", () => {
    const facts = [
      { fact_key: "cargo.weight", validation_status: "proposed" },
      { fact_key: pricingKey, validation_status: "validated" },
    ];
    const result = getRequestCloseLoopState("response_analyzed", facts, false);
    expect(result.state).toBe("awaiting_validation");
    expect(result.remainingProposedCount).toBe(1);
  });

  it("validated pricing-critical fact + pricing rerunning → pricing_rerunning", () => {
    const facts = [{ fact_key: pricingKey, validation_status: "validated" }];
    const result = getRequestCloseLoopState("facts_validated", facts, true);
    expect(result.state).toBe("pricing_rerunning");
    expect(result.remainingProposedCount).toBe(0);
  });

  it("all facts validated, no proposed, not rerunning → ready_to_close", () => {
    const facts = [{ fact_key: pricingKey, validation_status: "validated" }];
    const result = getRequestCloseLoopState("facts_validated", facts, false);
    expect(result.state).toBe("ready_to_close");
    expect(result.remainingProposedCount).toBe(0);
  });
});
