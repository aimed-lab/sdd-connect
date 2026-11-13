import test from "node:test";
import assert from "node:assert/strict";
import {
  DELETE_FILE_CONFIRM,
  FILE_DELETED_NOTICE,
  LAST_FILE_MESSAGE,
  REMOVE_FILE_CONFIRM,
  canRemoveFile,
  removeNeedsConfirm,
  fileStatusLine,
  fileVisibilityTag,
  visibilityButtonLabel,
} from "./manageFile.ts";
import { paperForSave, paperFromStored, shareKindForType, SHARE_KIND_TYPE, SHARE_KINDS } from "./quickShare.ts";

test("status line", () => {
  assert.equal(fileStatusLine(true), "Public. Anyone with the link can download it.");
  assert.equal(fileStatusLine(false), "Hidden. Only you can see this.");
});

test("tags and the visibility button use Public / Hidden words", () => {
  assert.equal(fileVisibilityTag(true), "Public");
  assert.equal(fileVisibilityTag(false), "Hidden");
  assert.equal(visibilityButtonLabel(true), "Hide");
  assert.equal(visibilityButtonLabel(false), "Make public");
});

test("no publish / draft words in any of the file screen wording", () => {
  const words = [
    fileStatusLine(true),
    fileStatusLine(false),
    fileVisibilityTag(true),
    fileVisibilityTag(false),
    visibilityButtonLabel(true),
    visibilityButtonLabel(false),
    LAST_FILE_MESSAGE,
    FILE_DELETED_NOTICE,
    ...Object.values(DELETE_FILE_CONFIRM),
    ...Object.values(REMOVE_FILE_CONFIRM),
  ].join(" ");
  assert.doesNotMatch(words, /publish|draft/i);
});

test("a public file page keeps its last file", () => {
  assert.deepEqual(canRemoveFile({ isPublic: true, hasBody: false, fileCount: 1 }), {
    ok: false,
    message: "A public file page needs at least one file.",
  });
  assert.deepEqual(canRemoveFile({ isPublic: true, hasBody: false, fileCount: 2 }), { ok: true });
});

test("a hidden file page, or a post with text, can lose its last file", () => {
  assert.deepEqual(canRemoveFile({ isPublic: false, hasBody: false, fileCount: 1 }), { ok: true });
  assert.deepEqual(canRemoveFile({ isPublic: true, hasBody: true, fileCount: 1 }), { ok: true });
});

test("delete confirmation wording", () => {
  assert.equal(DELETE_FILE_CONFIRM.heading, "Delete this file page?");
  assert.equal(DELETE_FILE_CONFIRM.message, "The files and the link will stop working. This can't be undone.");
  assert.equal(DELETE_FILE_CONFIRM.confirm, "Delete");
});

test("stored type back to the chip, for every chip", () => {
  for (const k of SHARE_KINDS) assert.equal(shareKindForType(SHARE_KIND_TYPE[k]), k);
  assert.equal(shareKindForType("paper"), "other");
  assert.equal(shareKindForType(null), "other");
});

test("a stored paper becomes the card, and saves back the same", () => {
  const stored = {
    title: "PHGDH in glioma",
    authors: "Smith J, Lee K",
    journal: "Nature",
    doi: "10.1/x",
    link: "https://doi.org/10.1/x",
    paperYear: 2025,
  };
  const card = paperFromStored(stored);
  assert.deepEqual(card, {
    title: "PHGDH in glioma",
    authors: ["Smith J", "Lee K"],
    journal: "Nature",
    doi: "10.1/x",
    publishedDate: "2025",
    sourceUrl: "https://doi.org/10.1/x",
  });
  assert.deepEqual(paperForSave(card), {
    title: "PHGDH in glioma",
    authors: ["Smith J", "Lee K"],
    journal: "Nature",
    doi: "10.1/x",
    link: "https://doi.org/10.1/x",
    year: 2025,
  });
});

test("no paper stored", () => {
  assert.equal(paperFromStored({ title: "assay results", doi: null, link: null }), null);
  assert.equal(paperFromStored({ title: "", doi: "10.1/x" }), null);
  assert.equal(paperForSave(null), null);
});

test("a doi without a link still gives a link", () => {
  assert.equal(paperFromStored({ title: "T", doi: "10.1/x" })?.sourceUrl, "https://doi.org/10.1/x");
});

test("remove confirmation wording", () => {
  assert.equal(REMOVE_FILE_CONFIRM.heading, "Remove this file?");
  assert.equal(REMOVE_FILE_CONFIRM.message, "People with the link won't be able to download it any more.");
  assert.equal(REMOVE_FILE_CONFIRM.confirm, "Remove");
});

test("only a finished file asks before removing; an upload in progress cancels straight away", () => {
  assert.equal(removeNeedsConfirm("done"), true);
  for (const s of ["uploading", "paused", "saving", "failed"]) assert.equal(removeNeedsConfirm(s), false, s);
});
