// Run with `npm test`. Files attached to a community or team resource
// (lib/server/communityFileRules.ts): what the uploader accepts, the content type it
// sends, and the checks recordCommunityResourceFile runs before writing the row.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMUNITY_FILE_ACCEPT,
  COMMUNITY_FILE_CONTENT_TYPES,
  MAX_COMMUNITY_FILE_BYTES,
  buildCommunityFilePath,
  checkCommunityFileType,
  checkStoredCommunityFile,
  communityFileKind,
  communityFileProblem,
  communityUploadContentType,
  isCommunityFilePathFor,
  shouldDiscardNewResource,
} from "./communityFileRules.ts";
import { checkProjectFileType } from "./projectFileRules.ts";

const COMMUNITY = "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b";
const OTHER = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
const FILE = "11111111-2222-4333-8444-555555555555";
const ME = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// The six types in the bucket's allowed_mime_types
// (database/migrations/2026-09-21_community_resource_files_storage.sql).
test("the accepted types are exactly the bucket's allowed list", () => {
  assert.deepEqual(
    [...COMMUNITY_FILE_CONTENT_TYPES].sort(),
    ["application/pdf", PPTX, "image/gif", "image/jpeg", "image/png", "image/webp"].sort()
  );
  for (const ext of ["png", "jpg", "jpeg", "webp", "gif", "pdf", "pptx"]) {
    assert.ok(COMMUNITY_FILE_ACCEPT.split(",").includes(`.${ext}`), ext);
  }
  for (const ext of ["docx", "xlsx", "ppt", "svg"]) assert.ok(!COMMUNITY_FILE_ACCEPT.includes(`.${ext},`), ext);
});

test("PowerPoint: the standard type is sent whatever the browser reported (shared with project files)", () => {
  for (const reported of ["", "application/octet-stream", "application/zip", PPTX, null]) {
    assert.equal(communityUploadContentType("Deck.pptx", reported), PPTX, String(reported));
    // The same helper as project files: both agree.
    const p = checkProjectFileType("Deck.pptx", reported);
    assert.equal(p.ok && p.contentType, PPTX);
  }
  assert.equal(communityUploadContentType("photo.JPG", ""), "image/jpeg");
  // Not accepted here: generic type, which the bucket refuses.
  assert.equal(communityUploadContentType("notes.docx", ""), "application/octet-stream");
});

test("checkCommunityFileType and communityFileProblem: extension, contradicting type, size", () => {
  assert.deepEqual(checkCommunityFileType("a.pdf", "application/pdf"), { ok: true, contentType: "application/pdf" });
  assert.equal(checkCommunityFileType("notes.docx", "").ok, false);
  assert.equal(checkCommunityFileType("report.pdf", "text/html").ok, false);
  assert.equal(communityFileProblem("deck.pptx", "", 30 * 1024 * 1024), null);
  assert.equal(communityFileProblem("deck.pptx", "", MAX_COMMUNITY_FILE_BYTES), null);
  assert.match(communityFileProblem("deck.pptx", "", MAX_COMMUNITY_FILE_BYTES + 1) ?? "", /over 50 MB/);
  assert.match(communityFileProblem("deck.pptx", "", 0) ?? "", /empty/);
  assert.match(communityFileProblem("data.csv", "text/csv", 10) ?? "", /PNG, JPEG, WebP, GIF, PDF or PPTX/);
});

test("paths: the community's id is the first folder; other communities and odd paths are refused", () => {
  const path = buildCommunityFilePath(COMMUNITY, FILE, "Kick-off deck (v2).pptx");
  assert.equal(path, `${COMMUNITY}/${FILE}-Kick-off-deck-v2.pptx`);
  assert.equal(isCommunityFilePathFor(path, COMMUNITY), true);
  assert.equal(isCommunityFilePathFor(path, OTHER), false);
  assert.equal(isCommunityFilePathFor(`${COMMUNITY}/../${OTHER}/${FILE}-a.pdf`, COMMUNITY), false);
  assert.equal(isCommunityFilePathFor(`${COMMUNITY}/sub/${FILE}-a.pdf`, COMMUNITY), false);
  // The old path shape (<community>/<uuid>.<ext>) is never accepted for a NEW record…
  assert.equal(isCommunityFilePathFor(`${COMMUNITY}/${FILE}.pdf`, COMMUNITY), false);
});

test("communityFileKind: the upload row's icon", () => {
  assert.equal(communityFileKind("a.png"), "image");
  assert.equal(communityFileKind("a.pptx"), "slides");
  assert.equal(communityFileKind("a.pdf"), "slides");
});

// ── the record checks ────────────────────────────────────────────────────────

const good = {
  communityId: COMMUNITY,
  path: `${COMMUNITY}/${FILE}-deck.pptx`,
  filename: "Deck.pptx",
  sizeBytes: 31 * 1024 * 1024,
  storedType: PPTX,
  ownerId: ME as string | null,
  callerId: ME,
};
const check = (over: Partial<typeof good> = {}) => checkStoredCommunityFile({ ...good, ...over });

test("record: a good upload passes, with the cleaned name and the standard type", () => {
  assert.deepEqual(check(), { ok: true, filename: "Deck.pptx", sizeBytes: 31 * 1024 * 1024, contentType: PPTX });
  // No owner in the Storage response: the other checks still run and pass.
  assert.equal(check({ ownerId: null }).ok, true);
});

test("record: a path outside this community's folder is refused and the object is NOT deleted", () => {
  const r = check({ path: `${OTHER}/${FILE}-deck.pptx` });
  assert.deepEqual(r, { ok: false, message: "That upload doesn't belong to this community.", deleteObject: false });
  const t = check({ path: `${COMMUNITY}/../${OTHER}/${FILE}-deck.pptx` });
  assert.equal(t.ok === false && t.deleteObject, false);
});

test("record: someone else's upload is refused and NOT deleted", () => {
  const r = check({ ownerId: "ffffffff-0000-4000-8000-000000000000" });
  assert.deepEqual(r, { ok: false, message: "That upload doesn't belong to you.", deleteObject: false });
});

test("record: empty, too big, wrong extension or wrong type is refused and the object deleted", () => {
  const cases: [Partial<typeof good>, RegExp][] = [
    [{ sizeBytes: 0 }, /empty/],
    [{ sizeBytes: Number.NaN }, /empty/],
    [{ sizeBytes: MAX_COMMUNITY_FILE_BYTES + 1 }, /up to 50 MB/],
    // the name shown has another extension than what was stored
    [{ filename: "Deck.pdf" }, /doesn't match the file you picked/],
    // stored type contradicts the extension
    [{ storedType: "text/html" }, /doesn't look like/],
    // an extension this bucket doesn't take, stored under a matching path
    [{ path: `${COMMUNITY}/${FILE}-notes.docx`, filename: "notes.docx", storedType: "" }, /can't be attached here/],
  ];
  for (const [over, msg] of cases) {
    const r = check(over);
    assert.equal(r.ok, false, JSON.stringify(over));
    if (!r.ok) {
      assert.match(r.message, msg, JSON.stringify(over));
      assert.equal(r.deleteObject, true, JSON.stringify(over));
    }
  }
  // exactly 50 MB is fine
  assert.equal(check({ sizeBytes: MAX_COMMUNITY_FILE_BYTES }).ok, true);
});

// ── the empty-entry cleanup ──────────────────────────────────────────────────

test("shouldDiscardNewResource: only a new, link-less entry with nothing attached or uploading", () => {
  const base = { createdHere: true, hasLink: false, attached: 0, stillUploading: 0 };
  assert.equal(shouldDiscardNewResource(base), true);
  assert.equal(shouldDiscardNewResource({ ...base, createdHere: false }), false); // an edited entry
  assert.equal(shouldDiscardNewResource({ ...base, hasLink: true }), false); // the link is worth keeping
  assert.equal(shouldDiscardNewResource({ ...base, attached: 1 }), false);
  assert.equal(shouldDiscardNewResource({ ...base, stillUploading: 1 }), false);
});

// ── the server and the forms use all of this ─────────────────────────────────

test("communities.ts: recordCommunityResourceFile runs the checks; the old FormData upload is gone", () => {
  const src = readFileSync(new URL("./communities.ts", import.meta.url), "utf8");
  const start = src.indexOf("export async function recordCommunityResourceFile(");
  assert.ok(start >= 0);
  const body = src.slice(start, src.indexOf("\nexport ", start + 1));
  assert.match(body, /getMembership\(communityId\)/);
  assert.match(body, /bucket\.info\(path\)/);
  assert.match(body, /checkStoredCommunityFile\(/);
  assert.match(body, /callerId: user\.id/);
  assert.match(body, /if \(deleteObject\)/);
  assert.ok(!src.includes("export async function addCommunityResourceFile("));
  // Old files: listed and removed by the path stored in the row, never rebuilt.
  assert.match(src, /signCommunityResourceFilePath\(db, row\.url as string\)/);
});

test("both forms upload through useCommunityFileUploads, never a FormData Server Action", () => {
  for (const f of ["../../components/communities/ResourcesSection.tsx", "../../components/teams/AddDocumentPanel.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /useCommunityFileUploads\(/, f);
    assert.match(src, /shouldDiscardNewResource\(/, f);
    assert.match(src, /deleteCommunityResourceAction\(/, f);
    assert.ok(!src.includes("addCommunityResourceFileAction"), f);
    assert.ok(!src.includes("new FormData"), f);
  }
});
