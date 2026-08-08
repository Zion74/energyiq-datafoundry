import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(
  join(process.cwd(), "src/app/energyiq/settings/settings-client.tsx"),
  "utf8",
);

describe("EnergyIQ settings", () => {
  it("separates editable profile data from read-only access assignments", () => {
    const file = source();

    expect(file).toContain('title="Profile"');
    expect(file).toContain('title="Company & projects"');
    expect(file).toContain('title="Security"');
    expect(file).toContain("Your access is assigned by an EnergyIQ administrator");
    expect(file).toContain("updateProfile({ displayName: nextName, avatarUrl })");
  });

  it("resizes supported avatar images before saving them", () => {
    const file = source();

    expect(file).toContain("createImageBitmap(file)");
    expect(file).toContain('canvas.toDataURL("image/webp", 0.82)');
    expect(file).toContain("MAX_AVATAR_INPUT_BYTES");
  });
});
