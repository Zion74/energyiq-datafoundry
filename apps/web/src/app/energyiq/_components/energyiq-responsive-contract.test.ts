import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const shell = readFileSync(new URL("./energyiq-shell.tsx", import.meta.url), "utf8");

describe("EnergyIQ responsive shell contract", () => {
  it("keeps tablet navigation separate from the desktop navigation row", () => {
    expect(shell).toContain('className="hidden h-full shrink-0 items-center gap-1 xl:flex"');
    expect(shell).toContain('className="grid border-t border-border xl:hidden"');
  });

  it("keeps long Workspace and Project context reachable without widening the page", () => {
    expect(shell).toContain("min-w-0 items-center gap-3 overflow-x-auto");
    expect(shell).toContain("[scrollbar-width:none]");
    expect(shell).toContain("shrink-0 sm:max-w-52");
    expect(shell).toContain("shrink-0 sm:max-w-60");
  });

  it("preserves current-page and keyboard-focus feedback in both navigation modes", () => {
    expect(shell).toContain('aria-current={active ? "page" : undefined}');
    expect(shell.match(/focus-visible:ring-2/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
