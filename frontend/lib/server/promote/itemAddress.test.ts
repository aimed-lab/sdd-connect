import test from "node:test";
import assert from "node:assert/strict";
import {
  afterDeletePath,
  editPageRedirect,
  fileShareTypeLabel,
  itemCardImagePath,
  itemCardImageUrlFor,
  itemEditPath,
  itemPageRedirect,
  itemPath,
  itemUrlFor,
  linkedPaperTitle,
  listedInRecentlyShared,
  listedInYourFiles,
  listedOnPromote,
} from "./itemAddress.ts";
import { promoteQrUrl, fileShareQrUrl } from "./qrCode.ts";
import { downloadButtonFor } from "./quickShare.ts";
import { fileDownloadHref } from "./mediaFiles.ts";

const SITE = "https://connect.smartdrugdiscovery.org";

// ── which address an item uses ──────────────────────────────────────────────

test("a file share lives under /files", () => {
  assert.equal(itemPath("assay-data", true), "/files/assay-data");
  assert.equal(itemEditPath("assay-data", true), "/files/assay-data/edit");
  assert.equal(itemUrlFor(SITE, "assay-data", true), `${SITE}/files/assay-data`);
  assert.equal(itemCardImagePath("assay-data", true), "/files/assay-data/opengraph-image");
  assert.equal(itemCardImageUrlFor(SITE, "assay-data", true), `${SITE}/files/assay-data/opengraph-image`);
});

test("a normal post keeps /promote", () => {
  assert.equal(itemPath("my-paper", false), "/promote/my-paper");
  assert.equal(itemEditPath("my-paper", false), "/promote/my-paper/edit");
  assert.equal(itemUrlFor(SITE, "my-paper", false), `${SITE}/promote/my-paper`);
  assert.equal(itemCardImageUrlFor(SITE, "my-paper", false), `${SITE}/promote/my-paper/opengraph-image`);
});

test("a trailing slash on the site address is ignored", () => {
  assert.equal(itemUrlFor(`${SITE}/`, "x", true), `${SITE}/files/x`);
});

test("the QR code uses the item's own address", () => {
  assert.equal(fileShareQrUrl(SITE, "assay-data"), `${SITE}/files/assay-data`);
  assert.equal(promoteQrUrl(SITE, "my-paper"), `${SITE}/promote/my-paper`);
});

test("download links are under /files for every item", () => {
  assert.equal(fileDownloadHref("assay-data", "m1"), "/files/assay-data/download/m1");
  assert.deepEqual(downloadButtonFor("assay-data", ["m1"]), {
    label: "Download file",
    href: "/files/assay-data/download/m1",
  });
});

// ── redirects ───────────────────────────────────────────────────────────────

test("/promote/<slug> for a file share redirects to /files/<slug>", () => {
  assert.equal(itemPageRedirect("promote", "assay-data", true), "/files/assay-data");
});

test("/files/<slug> for a normal post redirects to /promote/<slug>", () => {
  assert.equal(itemPageRedirect("files", "my-paper", false), "/promote/my-paper");
});

test("the right area does not redirect", () => {
  assert.equal(itemPageRedirect("files", "assay-data", true), null);
  assert.equal(itemPageRedirect("promote", "my-paper", false), null);
});

test("edit pages follow the same rule", () => {
  assert.equal(editPageRedirect("promote", "assay-data", true), "/files/assay-data/edit");
  assert.equal(editPageRedirect("files", "my-paper", false), "/promote/my-paper/edit");
  assert.equal(editPageRedirect("files", "assay-data", true), null);
});

test("after delete", () => {
  assert.equal(afterDeletePath(true), "/files?deleted=1");
  assert.equal(afterDeletePath(false), "/promote?deleted=1");
});

// ── list rules ──────────────────────────────────────────────────────────────

test("the Promote feed never lists file shares or drafts", () => {
  assert.equal(listedOnPromote({ published: true, is_file_share: false }), true);
  assert.equal(listedOnPromote({ published: true }), true); // before the column exists
  assert.equal(listedOnPromote({ published: true, is_file_share: true }), false);
  assert.equal(listedOnPromote({ published: false, is_file_share: false }), false);
});

test("Recently shared: published file shares only", () => {
  assert.equal(listedInRecentlyShared({ published: true, is_file_share: true }), true);
  assert.equal(listedInRecentlyShared({ published: false, is_file_share: true }), false);
  assert.equal(listedInRecentlyShared({ published: true, is_file_share: false }), false);
});

test("Your files: your own file shares, published or not", () => {
  assert.equal(listedInYourFiles({ published: false, is_file_share: true, owner_id: "u1" }, "u1"), true);
  assert.equal(listedInYourFiles({ published: true, is_file_share: true, owner_id: "u1" }, "u1"), true);
  assert.equal(listedInYourFiles({ published: true, is_file_share: true, owner_id: "u2" }, "u1"), false);
  assert.equal(listedInYourFiles({ published: true, is_file_share: false, owner_id: "u1" }, "u1"), false);
  assert.equal(listedInYourFiles({ published: true, is_file_share: true, owner_id: "u1" }, null), false);
});

test("linked paper title only when there is a paper", () => {
  assert.equal(linkedPaperTitle({ title: "PHGDH in glioma", doi: "10.1/x", link: null }), "PHGDH in glioma");
  assert.equal(linkedPaperTitle({ title: "PHGDH in glioma", doi: null, link: "https://doi.org/10.1/x" }), "PHGDH in glioma");
  assert.equal(linkedPaperTitle({ title: "assay results", doi: null, link: null }), null);
  assert.equal(linkedPaperTitle({ title: " ", doi: "10.1/x" }), null);
});

test("type names on the files list", () => {
  assert.equal(fileShareTypeLabel("dataset"), "Dataset");
  assert.equal(fileShareTypeLabel("talk"), "Slides");
  assert.equal(fileShareTypeLabel("tool"), "Tool");
  assert.equal(fileShareTypeLabel("other"), "Other");
  assert.equal(fileShareTypeLabel("paper"), "Other");
});
