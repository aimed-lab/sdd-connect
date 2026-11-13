import test from "node:test";
import assert from "node:assert/strict";
import {
  SHARE_KIND_TYPE,
  fileTitle,
  guessShareKind,
  missingBeforeShare,
  paperYear,
  prefillShareTitle,
  shortAuthors,
  uploadingLabel,
} from "./quickShare.ts";
import { parsePaperInput } from "./paperInput.ts";

// ── type guess ──────────────────────────────────────────────────────────────

test("pdf and pptx are Slides", () => {
  assert.equal(guessShareKind("talk.pdf"), "slides");
  assert.equal(guessShareKind("Deck FINAL.PPTX"), "slides");
});

test("data formats are Dataset", () => {
  for (const ext of ["csv", "tsv", "parquet", "xlsx", "json", "zip", "h5", "sdf"]) {
    assert.equal(guessShareKind(`data.${ext}`), "dataset", ext);
  }
  assert.equal(guessShareKind("Compounds.SDF"), "dataset");
});

test("anything else is Other", () => {
  assert.equal(guessShareKind("demo.mp4"), "other");
  assert.equal(guessShareKind("figure.png"), "other");
  assert.equal(guessShareKind("README"), "other");
  assert.equal(guessShareKind(".csv"), "other");
  assert.equal(guessShareKind("ppt.docx"), "other");
});

test("each choice maps to an existing item type", () => {
  assert.deepEqual(SHARE_KIND_TYPE, { dataset: "dataset", slides: "talk", tool: "tool", other: "other" });
});

// ── title prefill ───────────────────────────────────────────────────────────

test("dataset with a paper", () => {
  assert.equal(
    prefillShareTitle({ kind: "dataset", paperTitle: "PHGDH in glioma", firstFileName: "x.csv" }),
    "Data for: PHGDH in glioma"
  );
});

test("slides with a paper", () => {
  assert.equal(
    prefillShareTitle({ kind: "slides", paperTitle: " PHGDH in glioma ", firstFileName: "x.pdf" }),
    "Slides for: PHGDH in glioma"
  );
});

test("otherwise the first filename without its extension", () => {
  assert.equal(prefillShareTitle({ kind: "tool", paperTitle: "A paper", firstFileName: "dock_v2.zip" }), "dock_v2");
  assert.equal(prefillShareTitle({ kind: "other", paperTitle: "A paper", firstFileName: "a.b.tar.gz" }), "a.b.tar");
  assert.equal(prefillShareTitle({ kind: "dataset", paperTitle: null, firstFileName: "Assay results.xlsx" }), "Assay results");
  assert.equal(prefillShareTitle({ kind: "slides", paperTitle: "", firstFileName: "talk.pdf" }), "talk");
});

test("no file and no paper gives an empty title", () => {
  assert.equal(prefillShareTitle({ kind: "other", paperTitle: null, firstFileName: null }), "");
});

test("fileTitle", () => {
  assert.equal(fileTitle("C:\\fakepath\\results.csv"), "results");
  assert.equal(fileTitle("noext"), "noext");
  assert.equal(fileTitle(".hidden"), ".hidden");
});

// ── what is missing before Share ────────────────────────────────────────────

const ready = { filesReady: 1, uploading: false, title: "Data for: X", confirmed: true };

test("nothing missing when everything is there", () => {
  assert.equal(missingBeforeShare(ready), null);
});

test("an upload in progress comes first", () => {
  assert.equal(missingBeforeShare({ ...ready, uploading: true }), "Wait for the upload to finish.");
});

test("no finished file", () => {
  assert.equal(missingBeforeShare({ ...ready, filesReady: 0 }), "Add a file first.");
});

test("empty or blank title", () => {
  assert.equal(missingBeforeShare({ ...ready, title: "   " }), "Add a title.");
});

test("box not ticked", () => {
  assert.equal(
    missingBeforeShare({ ...ready, confirmed: false }),
    "Tick the box to confirm you can share this file."
  );
});

test("order: file before title before box", () => {
  assert.equal(missingBeforeShare({ filesReady: 0, uploading: false, title: "", confirmed: false }), "Add a file first.");
  assert.equal(missingBeforeShare({ filesReady: 1, uploading: false, title: "", confirmed: false }), "Add a title.");
});

test("uploadingLabel", () => {
  assert.equal(uploadingLabel(62, 100), "Uploading 62%...");
  assert.equal(uploadingLabel(0, 0), "Uploading 0%...");
  assert.equal(uploadingLabel(100, 100), "Uploading 99%...");
});

test("shortAuthors and paperYear", () => {
  assert.equal(shortAuthors(["A", "B"]), "A, B");
  assert.equal(shortAuthors(["A", "B", "C", "D"]), "A, B, C et al.");
  assert.equal(paperYear("2025-03-14"), "2025");
  assert.equal(paperYear(null), "");
});

// ── paper link parsing ──────────────────────────────────────────────────────

test("bare DOI", () => {
  assert.deepEqual(parsePaperInput("10.1101/2024.01.01.123456"), { kind: "doi", id: "10.1101/2024.01.01.123456" });
});

test("doi: prefix and doi.org links", () => {
  const want = { kind: "doi", id: "10.1038/s41586-020-2649-2" };
  assert.deepEqual(parsePaperInput("doi:10.1038/s41586-020-2649-2"), want);
  assert.deepEqual(parsePaperInput("DOI: 10.1038/s41586-020-2649-2"), want);
  assert.deepEqual(parsePaperInput("https://doi.org/10.1038/s41586-020-2649-2"), want);
  assert.deepEqual(parsePaperInput("http://dx.doi.org/10.1038/s41586-020-2649-2"), want);
  assert.deepEqual(parsePaperInput("doi.org/10.1038/s41586-020-2649-2"), want);
  assert.deepEqual(parsePaperInput("  <https://doi.org/10.1038/s41586-020-2649-2>. "), want);
});

test("encoded doi.org link is decoded", () => {
  assert.deepEqual(parsePaperInput("https://doi.org/10.1002%2Fanie.202000001"), {
    kind: "doi",
    id: "10.1002/anie.202000001",
  });
});

test("PubMed ID and PubMed links", () => {
  const want = { kind: "pmid", id: "38012345" };
  assert.deepEqual(parsePaperInput("38012345"), want);
  assert.deepEqual(parsePaperInput("PMID: 38012345"), want);
  assert.deepEqual(parsePaperInput("https://pubmed.ncbi.nlm.nih.gov/38012345/"), want);
  assert.deepEqual(parsePaperInput("pubmed.ncbi.nlm.nih.gov/38012345"), want);
  assert.deepEqual(parsePaperInput("https://pubmed.ncbi.nlm.nih.gov/38012345/?utm_source=x"), want);
  assert.deepEqual(parsePaperInput("https://www.ncbi.nlm.nih.gov/pubmed/38012345"), want);
});

test("things that are not a paper", () => {
  assert.equal(parsePaperInput(""), null);
  assert.equal(parsePaperInput("   "), null);
  assert.equal(parsePaperInput("a nice paper about cells"), null);
  assert.equal(parsePaperInput("https://example.org/paper"), null);
  assert.equal(parsePaperInput("https://pubmed.ncbi.nlm.nih.gov/?term=glioma"), null);
  assert.equal(parsePaperInput("https://doi.org/not-a-doi"), null);
  assert.equal(parsePaperInput("1234567890"), null);
});

// ── download page ───────────────────────────────────────────────────────────

import { cleanPaperYear, downloadButtonFor, paperDetailsLine } from "./quickShare.ts";
import { fileDownloadHref } from "./mediaFiles.ts";

test("one file: the button downloads it through its permanent link", () => {
  const id = "0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f70";
  assert.deepEqual(downloadButtonFor("my-data", [id]), {
    label: "Download file",
    href: fileDownloadHref("my-data", id),
  });
});

test("several files: the button jumps to the Files list", () => {
  assert.deepEqual(downloadButtonFor("my-data", ["a", "b"]), { label: "Download files", href: "#files" });
});

test("no downloadable file: no button", () => {
  assert.equal(downloadButtonFor("my-data", []), null);
});

test("paperDetailsLine puts the year after the journal", () => {
  assert.equal(paperDetailsLine("Smith J, Lee K", "Nature", 2025), "Smith J, Lee K · Nature · 2025");
  assert.equal(paperDetailsLine("", "Nature", "2025"), "Nature · 2025");
  assert.equal(paperDetailsLine("Smith J", null, null), "Smith J");
  assert.equal(paperDetailsLine(null, " ", undefined), "");
});

test("cleanPaperYear", () => {
  assert.equal(cleanPaperYear(2025), 2025);
  assert.equal(cleanPaperYear("2025-03-14"), 2025);
  assert.equal(cleanPaperYear("1999"), 1999);
  assert.equal(cleanPaperYear(1700), null);
  assert.equal(cleanPaperYear(2025.5), null);
  assert.equal(cleanPaperYear(""), null);
  assert.equal(cleanPaperYear(null), null);
  assert.equal(cleanPaperYear("soon"), null);
});
