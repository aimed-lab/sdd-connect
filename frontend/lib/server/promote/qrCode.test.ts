import test from "node:test";
import assert from "node:assert/strict";
import { promoteQrFileName, promoteQrUrl } from "./qrCode.ts";
import { DEFAULT_SITE_URL, articleUrlFor, siteUrl } from "./shareText.ts";

test("promoteQrUrl with no site configured points at the live site", () => {
  assert.equal(
    promoteQrUrl(siteUrl(undefined), "a-new-assay"),
    "https://connect.smartdrugdiscovery.org/promote/a-new-assay"
  );
  assert.equal(promoteQrUrl(siteUrl(""), "x"), `${DEFAULT_SITE_URL}/promote/x`);
});

test("promoteQrUrl uses the configured site address, not wherever the page was opened", () => {
  assert.equal(
    promoteQrUrl(siteUrl("https://staging.example.org/"), "x"),
    "https://staging.example.org/promote/x"
  );
});

test("promoteQrUrl is the same address the share buttons use", () => {
  const base = siteUrl(undefined);
  assert.equal(promoteQrUrl(base, "my-talk-r3f91"), articleUrlFor(base, "my-talk-r3f91"));
});

test("promoteQrUrl adds no query string or fragment", () => {
  const url = promoteQrUrl(siteUrl(undefined), "my-talk-r3f91");
  assert.equal(url.includes("?"), false);
  assert.equal(url.includes("#"), false);
});

test("promoteQrFileName is <slug>-qr.png", () => {
  assert.equal(promoteQrFileName("my-talk-r3f91"), "my-talk-r3f91-qr.png");
});
