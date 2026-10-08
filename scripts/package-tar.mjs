import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "theme.json"), "utf8"));
for (const key of ["name", "short", "description", "version", "author", "url"]) {
  if (typeof manifest[key] !== "string") throw new Error(`theme.json 缺少字符串字段 ${key}`);
}
if (!/^[a-zA-Z0-9_-]+$/.test(manifest.short)) throw new Error("主题 short 非法");
if (!existsSync(join(root, "dist/index.html"))) throw new Error("请先构建 dist/index.html");
const stage = mkdtempSync(join(tmpdir(), "sao-package-"));
try {
  const themeDir = join(stage, manifest.short);
  mkdirSync(themeDir);
  for (const file of ["theme.json", "dist", "preview.png"]) {
    if (existsSync(join(root, file))) cpSync(join(root, file), join(themeDir, file), { recursive: true });
  }
  // 官方格式：解压后为 <short>/theme.json 和 <short>/dist/index.html。
  const archive = join(root, "theme.tar.gz");
  execFileSync("tar", ["--exclude=.DS_Store", "-czf", archive, "-C", stage, manifest.short], {
    env: { ...process.env, COPYFILE_DISABLE: "1" }, stdio: "inherit",
  });
  execFileSync("gzip", ["-t", archive], { stdio: "inherit" });
  cpSync(archive, join(root, `${manifest.short}-theme-v${manifest.version}.tar.gz`));
  console.log(`已生成并校验 theme.tar.gz（根目录 ${manifest.short}/）`);
} finally { rmSync(stage, { recursive: true, force: true }); }
