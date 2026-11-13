import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MEDIA_BYTES,
  buildMediaObjectPath,
  cleanFileName,
  cleanMediaLabel,
  displayFileName,
  fileExtension,
  fileTooLargeMessage,
  formatFileSize,
  isMediaObjectPathFor,
  mediaKindFor,
  fileDownloadHref,
  legacyFileDownloadHref,
  uploadContentType,
} from "./mediaFiles.ts";

const ITEM = "3f2a9c1e-8b7d-4c6a-9e5f-1a2b3c4d5e6f";
const FILE = "0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f70";

// ── kind from file type ─────────────────────────────────────────────────────

test("the four inline image types are images", () => {
  for (const t of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
    assert.equal(mediaKindFor(t, "x"), "image", t);
  }
});

test("PDF and PPTX stay slides", () => {
  assert.equal(mediaKindFor("application/pdf", "deck.pdf"), "slides");
  assert.equal(
    mediaKindFor("application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx"),
    "slides"
  );
});

test("everything else is a file, including other image types", () => {
  assert.equal(mediaKindFor("text/csv", "data.csv"), "file");
  assert.equal(mediaKindFor("application/zip", "code.zip"), "file");
  assert.equal(mediaKindFor("video/mp4", "demo.mp4"), "file");
  assert.equal(mediaKindFor("image/svg+xml", "logo.svg"), "file");
  assert.equal(mediaKindFor("image/tiff", "scan.tif"), "file");
});

test("a real content type wins over the extension", () => {
  assert.equal(mediaKindFor("text/plain", "notes.png"), "file");
});

test("an empty or generic type falls back to the extension", () => {
  assert.equal(mediaKindFor("", "table.parquet"), "file");
  assert.equal(mediaKindFor(null, "Figure 1.PNG"), "image");
  assert.equal(mediaKindFor("application/octet-stream", "slides.pdf"), "slides");
  assert.equal(mediaKindFor(undefined, "noextension"), "file");
});

test("content type parameters and case are ignored", () => {
  assert.equal(mediaKindFor("Image/PNG; charset=binary", "x"), "image");
});

test("uploadContentType sends a generic type when the browser has none", () => {
  assert.equal(uploadContentType(""), "application/octet-stream");
  assert.equal(uploadContentType(undefined), "application/octet-stream");
  assert.equal(uploadContentType("text/csv"), "text/csv");
});

// ── filename cleaning ───────────────────────────────────────────────────────

test("cleanFileName keeps safe names as they are", () => {
  assert.equal(cleanFileName("results_v2.parquet"), "results_v2.parquet");
});

test("cleanFileName replaces spaces, accents and symbols", () => {
  assert.equal(cleanFileName("Résumé final (v3).pdf"), "Resume-final-v3.pdf");
  assert.equal(cleanFileName("a  b&c#d.csv"), "a-b-c-d.csv");
});

test("cleanFileName removes folders and path tricks", () => {
  assert.equal(cleanFileName("../../etc/passwd"), "passwd");
  assert.equal(cleanFileName("C:\\Users\\me\\data.zip"), "data.zip");
  assert.equal(cleanFileName(".hidden"), "hidden");
  assert.equal(cleanFileName("x/"), "file");
});

test("cleanFileName is never empty", () => {
  assert.equal(cleanFileName(""), "file");
  assert.equal(cleanFileName("数据.csv"), "file.csv");
  assert.equal(cleanFileName("a.tar.gz"), "a.tar.gz");
  assert.equal(cleanFileName("..."), "file");
});

test("cleanFileName shortens long names and keeps the extension", () => {
  const out = cleanFileName(`${"a".repeat(300)}.parquet`);
  assert.ok(out.length <= 100, String(out.length));
  assert.ok(out.endsWith(".parquet"));
});

test("cleanFileName output only uses safe characters", () => {
  for (const name of ["über data (final).tar.gz", "a/b\\c:d*e?f\"g<h>i|j", "🙂 smile.mp4"]) {
    assert.match(cleanFileName(name), /^[A-Za-z0-9._-]+$/);
  }
});

test("displayFileName keeps the original name but drops folders and control characters", () => {
  assert.equal(displayFileName("Résumé final (v3).pdf"), "Résumé final (v3).pdf");
  assert.equal(displayFileName("C:\\fakepath\\data.csv"), "data.csv");
  assert.equal(displayFileName('bad"name\n.csv'), "badname.csv");
  assert.equal(displayFileName(""), "file");
  assert.equal(displayFileName("x".repeat(500)).length, 200);
});

test("fileExtension", () => {
  assert.equal(fileExtension("a.tar.gz"), "gz");
  assert.equal(fileExtension("README"), "");
  assert.equal(fileExtension(".env"), "");
  assert.equal(fileExtension("x."), "");
});

// ── object paths ────────────────────────────────────────────────────────────

test("buildMediaObjectPath puts the file in the item's folder", () => {
  assert.equal(buildMediaObjectPath(ITEM, FILE, "My data.csv"), `${ITEM}/${FILE}-My-data.csv`);
});

test("isMediaObjectPathFor accepts a path built for that item", () => {
  assert.equal(isMediaObjectPathFor(buildMediaObjectPath(ITEM, FILE, "a b.zip"), ITEM), true);
});

test("isMediaObjectPathFor refuses another item's folder, nesting and tricks", () => {
  const other = "11111111-2222-4333-8444-555555555555";
  assert.equal(isMediaObjectPathFor(buildMediaObjectPath(other, FILE, "a.zip"), ITEM), false);
  assert.equal(isMediaObjectPathFor(`${ITEM}/${FILE}-a/b.zip`, ITEM), false);
  assert.equal(isMediaObjectPathFor(`${ITEM}/../${other}/${FILE}-a.zip`, ITEM), false);
  assert.equal(isMediaObjectPathFor(`${ITEM}/not-a-uuid-a.zip`, ITEM), false);
  assert.equal(isMediaObjectPathFor(`${ITEM}/${FILE}-a b.zip`, ITEM), false);
  assert.equal(isMediaObjectPathFor(`${ITEM}/${FILE}-.hidden`, ITEM), false);
  assert.equal(isMediaObjectPathFor(`x${ITEM}/${FILE}-a.zip`, ITEM), false);
  assert.equal(isMediaObjectPathFor(`${ITEM}/${FILE}-a.zip`, "not-a-uuid"), false);
});

// ── labels ──────────────────────────────────────────────────────────────────

test("cleanMediaLabel makes one line and trims", () => {
  assert.equal(cleanMediaLabel("  External evaluation set\nused in   Table 3 "), "External evaluation set used in Table 3");
});

test("cleanMediaLabel turns empty into null and caps at 200", () => {
  assert.equal(cleanMediaLabel("   "), null);
  assert.equal(cleanMediaLabel(null), null);
  assert.equal(cleanMediaLabel("x".repeat(250))?.length, 200);
});

// ── links ───────────────────────────────────────────────────────────────────

test("fileDownloadHref is the permanent per-file link, under /files", () => {
  assert.equal(fileDownloadHref("my-paper-ab12c", FILE), `/files/my-paper-ab12c/download/${FILE}`);
});

test("fileDownloadHref encodes odd characters", () => {
  assert.equal(fileDownloadHref("a b", "x/y"), "/files/a%20b/download/x%2Fy");
});

test("the old /promote download address is kept for redirects", () => {
  assert.equal(legacyFileDownloadHref("my-paper-ab12c", FILE), `/promote/my-paper-ab12c/files/${FILE}`);
});

// ── size ────────────────────────────────────────────────────────────────────

test("the limit is 50 MB", () => {
  assert.equal(MAX_MEDIA_BYTES, 50 * 1024 * 1024);
});

test("fileTooLargeMessage is null at or under the limit", () => {
  assert.equal(fileTooLargeMessage("a.csv", MAX_MEDIA_BYTES), null);
  assert.equal(fileTooLargeMessage("a.csv", 10), null);
});

test("fileTooLargeMessage names the file, its size and the limit", () => {
  assert.equal(
    fileTooLargeMessage("big.zip", MAX_MEDIA_BYTES + 1),
    '"big.zip" is too large (50 MB). Files can be up to 50 MB.'
  );
  assert.equal(
    fileTooLargeMessage("video.mp4", 120 * 1024 * 1024),
    '"video.mp4" is too large (120 MB). Files can be up to 50 MB.'
  );
});

test("formatFileSize", () => {
  assert.equal(formatFileSize(0), "0 bytes");
  assert.equal(formatFileSize(1), "1 byte");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(500 * 1024), "500 KB");
  assert.equal(formatFileSize(5.25 * 1024 * 1024), "5.3 MB");
  assert.equal(formatFileSize(3 * 1024 * 1024 * 1024), "3.0 GB");
  assert.equal(formatFileSize(-1), "");
});
