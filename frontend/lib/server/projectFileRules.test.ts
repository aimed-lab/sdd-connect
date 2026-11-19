import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROJECT_FILE_BYTES,
  PROJECT_FILE_ACCEPT,
  buildProjectFilePath,
  canRemoveProjectFile,
  checkProjectFileType,
  isProjectFilePathFor,
  projectFileHref,
  projectFileKind,
  projectFileProblem,
  sharedDateLabel,
} from "./projectFileRules.ts";

const PROJECT = "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b";
const OTHER = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
const FILE = "11111111-2222-4333-8444-555555555555";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ── paths ────────────────────────────────────────────────────────────────────

test("buildProjectFilePath: the project's id is the first folder, the name is cleaned", () => {
  assert.equal(buildProjectFilePath(PROJECT, FILE, "Kick-off deck (v2).pptx"), `${PROJECT}/${FILE}-Kick-off-deck-v2.pptx`);
  assert.equal(buildProjectFilePath(PROJECT, FILE, "../../etc/passwd.pdf"), `${PROJECT}/${FILE}-passwd.pdf`);
  assert.equal(buildProjectFilePath(PROJECT, FILE, "Résumé.docx"), `${PROJECT}/${FILE}-Resume.docx`);
});

test("isProjectFilePathFor: accepts what buildProjectFilePath makes for this project only", () => {
  const path = buildProjectFilePath(PROJECT, FILE, "Budget 2026.xlsx");
  assert.equal(isProjectFilePathFor(path, PROJECT), true);
  assert.equal(isProjectFilePathFor(path.toUpperCase().replace(".XLSX", ".xlsx"), PROJECT), true);
  // another project's folder
  assert.equal(isProjectFilePathFor(path, OTHER), false);
  assert.equal(isProjectFilePathFor(buildProjectFilePath(OTHER, FILE, "a.pdf"), PROJECT), false);
});

test("isProjectFilePathFor: refuses traversal, nesting and malformed names", () => {
  assert.equal(isProjectFilePathFor(`${PROJECT}/../${OTHER}/${FILE}-a.pdf`, PROJECT), false);
  assert.equal(isProjectFilePathFor(`${PROJECT}/sub/${FILE}-a.pdf`, PROJECT), false);
  assert.equal(isProjectFilePathFor(`${PROJECT}/${FILE}-`, PROJECT), false);
  assert.equal(isProjectFilePathFor(`${PROJECT}/not-a-uuid-a.pdf`, PROJECT), false);
  assert.equal(isProjectFilePathFor(`${PROJECT}/${FILE}-has space.pdf`, PROJECT), false);
  assert.equal(isProjectFilePathFor(`${PROJECT}${FILE}-a.pdf`, PROJECT), false);
  assert.equal(isProjectFilePathFor(`${PROJECT}/${FILE}-a.pdf`, "not-a-uuid"), false);
  assert.equal(isProjectFilePathFor("", PROJECT), false);
});

test("projectFileHref: the stable members-only link", () => {
  assert.equal(projectFileHref(PROJECT, FILE), `/projects/${PROJECT}/files/${FILE}`);
});

// ── type check ───────────────────────────────────────────────────────────────

test("checkProjectFileType: every allowed extension, with its standard type", () => {
  const cases: [string, string, string][] = [
    ["a.png", "image/png", "image"],
    ["a.jpg", "image/jpeg", "image"],
    ["a.jpeg", "image/jpeg", "image"],
    ["a.gif", "image/gif", "image"],
    ["a.webp", "image/webp", "image"],
    ["a.pdf", "application/pdf", "pdf"],
    ["a.ppt", "application/vnd.ms-powerpoint", "slides"],
    ["a.pptx", PPTX, "slides"],
    ["a.doc", "application/msword", "document"],
    ["a.docx", DOCX, "document"],
    ["a.xls", "application/vnd.ms-excel", "spreadsheet"],
    ["a.xlsx", XLSX, "spreadsheet"],
  ];
  for (const [name, type, kind] of cases) {
    assert.deepEqual(checkProjectFileType(name, type), { ok: true, kind, contentType: type }, name);
  }
});

test("checkProjectFileType: the extension decides, case-insensitively", () => {
  assert.deepEqual(checkProjectFileType("Deck.PPTX", PPTX), { ok: true, kind: "slides", contentType: PPTX });
});

test("checkProjectFileType: inconsistent browser types for Office files are accepted", () => {
  // empty / generic: common for .pptx and .ppt on Windows and in some browsers
  for (const t of ["", "application/octet-stream", null, undefined]) {
    assert.deepEqual(checkProjectFileType("deck.pptx", t), { ok: true, kind: "slides", contentType: PPTX }, String(t));
  }
  // older and vendor types
  assert.equal(checkProjectFileType("deck.ppt", "application/mspowerpoint").ok, true);
  assert.equal(checkProjectFileType("deck.ppt", "application/vnd.ms-office").ok, true);
  assert.equal(checkProjectFileType("deck.pptx", "application/vnd.ms-powerpoint").ok, true);
  // newer formats are zip files and are sometimes reported as such
  assert.equal(checkProjectFileType("deck.pptx", "application/zip").ok, true);
  assert.equal(checkProjectFileType("notes.docx", "application/x-zip-compressed").ok, true);
  assert.equal(checkProjectFileType("sheet.xls", "application/x-msexcel").ok, true);
  // parameters and case in the reported type
  assert.equal(checkProjectFileType("a.pdf", "Application/PDF; charset=binary").ok, true);
  // whatever was reported, the upload uses the standard type
  const r = checkProjectFileType("deck.pptx", "application/zip");
  assert.equal(r.ok && r.contentType, PPTX);
});

test("checkProjectFileType: refuses other extensions, including no extension", () => {
  for (const name of ["data.csv", "tool.zip", "page.html", "image.svg", "run.exe", "notes.txt", "deck.key", "README", "archive.pdf.exe"]) {
    const r = checkProjectFileType(name, "");
    assert.equal(r.ok, false, name);
  }
});

test("checkProjectFileType: refuses a type that contradicts the extension", () => {
  assert.equal(checkProjectFileType("report.pdf", "text/html").ok, false);
  assert.equal(checkProjectFileType("photo.png", "image/svg+xml").ok, false);
  assert.equal(checkProjectFileType("deck.pptx", "application/pdf").ok, false);
  assert.equal(checkProjectFileType("sheet.xlsx", "application/x-msdownload").ok, false);
  // an image type on an Office extension, and the other way round
  assert.equal(checkProjectFileType("notes.docx", "image/png").ok, false);
  assert.equal(checkProjectFileType("photo.jpg", "application/msword").ok, false);
});

test("projectFileProblem: type, empty and the 50 MB limit", () => {
  assert.equal(projectFileProblem("deck.pptx", "", 30 * 1024 * 1024), null);
  assert.equal(projectFileProblem("deck.pptx", "", MAX_PROJECT_FILE_BYTES), null);
  assert.match(projectFileProblem("deck.pptx", "", MAX_PROJECT_FILE_BYTES + 1) ?? "", /over 50 MB/);
  assert.match(projectFileProblem("deck.pptx", "", 0) ?? "", /empty/);
  assert.match(projectFileProblem("data.csv", "text/csv", 10) ?? "", /can't be shared here/);
});

test("PROJECT_FILE_ACCEPT lists every allowed extension", () => {
  for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx"]) {
    assert.ok(PROJECT_FILE_ACCEPT.split(",").includes(`.${ext}`), ext);
  }
  assert.ok(!PROJECT_FILE_ACCEPT.includes(".svg"));
});

test("projectFileKind: by name; anything unknown shows as a document", () => {
  assert.equal(projectFileKind("a.PDF"), "pdf");
  assert.equal(projectFileKind("a.ppt"), "slides");
  assert.equal(projectFileKind("a.xlsx"), "spreadsheet");
  assert.equal(projectFileKind("a.webp"), "image");
  assert.equal(projectFileKind("a"), "document");
});

// ── who may remove ───────────────────────────────────────────────────────────

test("canRemoveProjectFile: the uploader, a lead or a manager", () => {
  const me = "u1";
  assert.equal(canRemoveProjectFile({ viewerId: me, addedBy: me, role: "member" }), true);
  assert.equal(canRemoveProjectFile({ viewerId: me, addedBy: "u2", role: "member" }), false);
  assert.equal(canRemoveProjectFile({ viewerId: me, addedBy: "u2", role: "lead" }), true);
  assert.equal(canRemoveProjectFile({ viewerId: me, addedBy: "u2", role: "manager" }), true);
  // uploader's account gone: only staff
  assert.equal(canRemoveProjectFile({ viewerId: me, addedBy: null, role: "member" }), false);
  assert.equal(canRemoveProjectFile({ viewerId: me, addedBy: null, role: "manager" }), true);
  assert.equal(canRemoveProjectFile({ viewerId: me, addedBy: "u2", role: null }), false);
});

test("sharedDateLabel: a UTC date, empty for garbage", () => {
  assert.equal(sharedDateLabel("2026-11-19T23:30:00Z"), "Nov 19, 2026");
  assert.equal(sharedDateLabel("nope"), "");
});
