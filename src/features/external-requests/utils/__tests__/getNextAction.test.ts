import { describe, it, expect, vi, afterEach } from "vitest";
import { getNextAction } from "../getNextAction";
import { STALE_THRESHOLD_HOURS } from "../../constants";

const recent = new Date().toISOString();

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 36e5).toISOString();
}

describe("getNextAction", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draft → awaiting_send", () => {
    expect(
      getNextAction({ status: "draft", responsesCount: 0, proposedFactsCount: 0, lastUpdateAt: recent }),
    ).toBe("awaiting_send");
  });

  it("sent, no responses, within threshold → awaiting_response", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-23T12:00:00Z");
    vi.setSystemTime(now);

    expect(
      getNextAction({
        status: "sent",
        responsesCount: 0,
        proposedFactsCount: 0,
        lastUpdateAt: new Date("2026-03-23T11:00:00Z").toISOString(), // 1h ago
      }),
    ).toBe("awaiting_response");
  });

  it("sent, no responses, past threshold → stale_followup", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-25T12:00:00Z");
    vi.setSystemTime(now);

    expect(
      getNextAction({
        status: "sent",
        responsesCount: 0,
        proposedFactsCount: 0,
        lastUpdateAt: new Date("2026-03-23T00:00:00Z").toISOString(), // 60h ago
      }),
    ).toBe("stale_followup");
  });

  it("response_received → response_to_analyze", () => {
    expect(
      getNextAction({ status: "response_received", responsesCount: 1, proposedFactsCount: 0, lastUpdateAt: recent }),
    ).toBe("response_to_analyze");
  });

  it("response_analyzed + proposed facts → facts_to_validate", () => {
    expect(
      getNextAction({ status: "response_analyzed", responsesCount: 1, proposedFactsCount: 2, lastUpdateAt: recent }),
    ).toBe("facts_to_validate");
  });

  it("response_analyzed + no proposed facts → ready", () => {
    expect(
      getNextAction({ status: "response_analyzed", responsesCount: 1, proposedFactsCount: 0, lastUpdateAt: recent }),
    ).toBe("ready");
  });

  it("partially_validated + proposed facts → facts_to_validate", () => {
    expect(
      getNextAction({ status: "partially_validated", responsesCount: 1, proposedFactsCount: 1, lastUpdateAt: recent }),
    ).toBe("facts_to_validate");
  });

  it("partially_validated + no proposed facts → ready", () => {
    expect(
      getNextAction({ status: "partially_validated", responsesCount: 1, proposedFactsCount: 0, lastUpdateAt: recent }),
    ).toBe("ready");
  });

  it("facts_validated → ready", () => {
    expect(
      getNextAction({ status: "facts_validated", responsesCount: 1, proposedFactsCount: 0, lastUpdateAt: recent }),
    ).toBe("ready");
  });

  it("closed → closed", () => {
    expect(
      getNextAction({ status: "closed", responsesCount: 5, proposedFactsCount: 3, lastUpdateAt: recent }),
    ).toBe("closed");
  });

  // M1-lite regression lock: unknown status must NOT return "awaiting_response"
  it("unknown status → ready (M1-lite regression lock)", () => {
    expect(
      getNextAction({ status: "unknown_status_xyz", responsesCount: 0, proposedFactsCount: 0, lastUpdateAt: recent }),
    ).toBe("ready");
  });

  it("uses STALE_THRESHOLD_HOURS from constants", () => {
    expect(STALE_THRESHOLD_HOURS).toBe(24);
  });
});
