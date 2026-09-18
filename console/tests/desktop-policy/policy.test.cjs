const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isAppUrl, isExternalUrl, windowBounds } = require("../../electron/policy.cjs");

describe("desktop navigation boundaries", () => {
  const origin = "http://127.0.0.1:3215";
  it("should trust only the server's complete origin", () => {
    assert.equal(isAppUrl(`${origin}/?demo=1`, origin), true);
    for (const url of ["http://127.0.0.1:3216/", "http://127.0.0.1.evil.test:3215", "file:///etc/passwd", "https://gitlab.com", "invalid"]) {
      assert.equal(isAppUrl(url, origin), false);
    }
    assert.equal(isAppUrl(origin, undefined), false);
  });
  it("should open web links but reject executable protocols and credentials", () => {
    assert.equal(isExternalUrl("https://gitlab.com/group/repo/-/issues/1"), true);
    assert.equal(isExternalUrl("http://localhost:3000"), true);
    for (const url of ["file:///tmp/test", "javascript:alert(1)", "vscode://file/tmp/test", "data:text/html,hello", "https://name:secret@example.com", "invalid"]) {
      assert.equal(isExternalUrl(url), false);
    }
  });
});

describe("restoring native windows", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  it("should restore visible bounds and discard a disconnected monitor", () => {
    const bounds = { x: 20, y: 30, width: 1200, height: 800 };
    assert.deepEqual(windowBounds(bounds, displays), bounds);
    assert.deepEqual(windowBounds({ ...bounds, x: 3000 }, displays), {});
    assert.deepEqual(windowBounds({ ...bounds, y: -2000 }, displays), {});
    assert.deepEqual(windowBounds({ ...bounds, width: "broken" }, displays), {});
  });
});
