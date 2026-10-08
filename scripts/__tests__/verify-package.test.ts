import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyThemeArchive } from "../verify-package.mjs";

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(prefix = "", withIndex = true) {
  const dir = mkdtempSync(join(tmpdir(), "sao-archive-test-"));
  scratch.push(dir);
  const stage = join(dir, "stage");
  const contents = join(stage, prefix);
  mkdirSync(join(contents, "dist"), { recursive: true });
  writeFileSync(join(contents, "theme.json"), JSON.stringify({ name: "SAO", short: "sao", description: "", version: "1", author: "", url: "" }));
  if (withIndex) writeFileSync(join(contents, "dist/index.html"), "<html></html>");
  const archive = join(dir, "theme.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", stage, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return archive;
}

describe("Monitor 安装包布局", () => {
  it("接受包根目录的清单和页面", () => { expect(verifyThemeArchive(fixture()).short).toBe("sao"); });
  it("拒绝错误的 sao/ 外层目录（v1.1.5-jksr.1 回归）", () => {
    expect(() => verifyThemeArchive(fixture("sao"))).toThrow("根目录缺少 theme.json");
  });
  it("拒绝只有清单而缺少页面的包", () => {
    expect(() => verifyThemeArchive(fixture("", false))).toThrow("根目录缺少 dist/index.html");
  });
});
