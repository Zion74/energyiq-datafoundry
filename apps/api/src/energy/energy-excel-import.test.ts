import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";

import { inspectEnergyExcelWorkbook } from "./energy-excel-import.js";

describe("inspectEnergyExcelWorkbook", () => {
  it("detects cumulative meter labels, coverage and quality evidence", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Lvl 6 Office Load 1"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Lvl 6 Office Load 1"), date("2026-05-01T00:15:00Z"), number(100.4)],
      [text("Lvl 6 Office Load 1"), date("2026-05-01T00:15:00Z"), number(100.4)],
      [text("Lvl 6 Total Office Load"), date("2026-05-01T00:00:00Z"), number(500)],
      [text(""), text("not-a-date"), text("bad")],
    ]).toBuffer();

    const inspection = await inspectEnergyExcelWorkbook(workbook);

    expect(inspection.readingKind).toBe("cumulative");
    expect(inspection.rowCount).toBe(5);
    expect(inspection.validRowCount).toBe(4);
    expect(inspection.invalidRowCount).toBe(1);
    expect(inspection.duplicateReadingCount).toBe(1);
    expect(inspection.typicalIntervalMinutes).toBe(15);
    expect(inspection.sourceLabels).toEqual([
      { label: "Lvl 6 Office Load 1", rowCount: 3 },
      { label: "Lvl 6 Total Office Load", rowCount: 1 },
    ]);
    expect(inspection.qualityStatus).toBe("needs_review");
  });

  it("rejects a workbook without the cumulative reading contract", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time")],
      [text("Meter 1"), date("2026-05-01T00:00:00Z")],
    ]).toBuffer();
    await expect(inspectEnergyExcelWorkbook(workbook)).rejects.toThrow(
      "ENERGYIQ_EXCEL_COLUMN_REQUIRED:Active Energy",
    );
  });
});

const text = (value: string) => ({ type: String, value });
const number = (value: number) => ({ type: Number, value });
const date = (value: string) => ({ type: Date, value: new Date(value), format: "yyyy-mm-dd hh:mm" });
