import { execFileSync } from "node:child_process";

// 与 monitor src/frontend.rs 的 publish 一致：根目录读取这两个文件，
// 不会搜索或剥离 short/ 包装目录。gzip -t 同时校验压缩流尾部。
export function verifyThemeArchive(archive) {
  execFileSync("gzip", ["-t", archive]);
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
  const byPath = new Map(names.map((name) => [name.replace(/^(\.\/)+/, ""), name]));
  for (const required of ["theme.json", "dist/index.html"]) {
    if (!byPath.has(required)) throw new Error(`主题包根目录缺少 ${required}，不能包含额外的 short/ 目录`);
  }
  for (const path of byPath.keys()) {
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("主题包路径越界");
  }
  const manifest = JSON.parse(execFileSync("tar", ["-xOzf", archive, byPath.get("theme.json")], { encoding: "utf8" }));
  for (const field of ["name", "short", "description", "version", "author", "url"]) {
    if (typeof manifest[field] !== "string") throw new Error(`theme.json 缺少字符串字段 ${field}`);
  }
  if (!manifest.name || !/^[a-zA-Z0-9_-]+$/.test(manifest.short)) throw new Error("主题名称或 short 非法");
  return manifest;
}
