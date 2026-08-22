import test from "node:test";
import assert from "node:assert/strict";
import { projectComboboxOptions, projectComboboxPlacement } from "../project-combobox.js";

test("project combobox exposes existing projects while preserving their real names", () => {
  assert.deepEqual(projectComboboxOptions([
    { name: "优质精选" },
    { name: "AIArtWorks · MJ 精选" }
  ]), [
    { value: "优质精选", label: "优质精选" },
    { value: "AIArtWorks · MJ 精选", label: "AIArtWorks · MJ 精选" }
  ]);
});

test("project combobox filters case-insensitively and removes duplicate or empty projects", () => {
  assert.deepEqual(projectComboboxOptions([
    { name: " AIArtWorks   精选 " },
    { name: "aiartworks 精选" },
    { name: "" },
    null,
    { value: "Higgsfield" }
  ], "AIART"), [
    { value: "AIArtWorks 精选", label: "AIArtWorks 精选" }
  ]);
});

test("project combobox opens toward the side that can contain its options", () => {
  assert.deepEqual(projectComboboxPlacement({
    inputTop: 420,
    inputBottom: 456,
    boundaryTop: 80,
    boundaryBottom: 520,
    contentHeight: 220,
    gap: 5
  }), { placement: "top", maxHeight: 335 });
  assert.deepEqual(projectComboboxPlacement({
    inputTop: 120,
    inputBottom: 156,
    boundaryTop: 80,
    boundaryBottom: 520,
    contentHeight: 220,
    gap: 5
  }), { placement: "bottom", maxHeight: 359 });
});

test("project combobox keeps the larger side when neither direction fits fully", () => {
  assert.deepEqual(projectComboboxPlacement({
    inputTop: 230,
    inputBottom: 266,
    boundaryTop: 100,
    boundaryBottom: 360,
    contentHeight: 320,
    gap: 5
  }), { placement: "top", maxHeight: 125 });
});
