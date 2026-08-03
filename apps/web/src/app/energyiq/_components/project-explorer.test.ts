import { describe, expect, it } from "vitest";

import { formatDateInput } from "./project-explorer";

describe("Project Explorer trusted date inputs", () => {
  it("uses the Project timezone for inclusive Custom dates", () => {
    expect(formatDateInput("2026-06-09T16:00:00.000Z", "Asia/Singapore")).toBe("2026-06-10");
    expect(formatDateInput("2026-06-16T15:59:59.999Z", "Asia/Singapore")).toBe("2026-06-16");
  });
});
