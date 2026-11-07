import { useSyncExternalStore } from "react";
import english from "./locales/en.json";

export type Language = "zh" | "en";
let language: Language = "zh";
const listeners = new Set<() => void>();
export function setLanguage(next: Language) {
  if (next === language) return;
  language = next;
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  listeners.forEach((listener) => listener());
}
export function useLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => language,
  );
}
const dictionary: Record<string, string> = english;
// Dynamic labels keep user supplied names, paths, and version numbers intact.
const patterns: [RegExp, string][] = [
  [/^打开官方 (.+)$/, "Open official $1"],
  [/^打开 (.+)$/, "Open $1"],
  [
    /^为 (.+) 配置下载与工具访问网络。$/,
    "Configure downloads and tool networking for $1.",
  ],
  [/^电脑代理 · (.+)$/, "PC proxy · $1"],
  [/^最新版本：(.+)$/, "Latest version: $1"],
  [/^当前版本：(.+)$/, "Current version: $1"],
  [
    /^仅统计当前程序启动后 (.+) 的任务；不代表供应商 Token 用量或账单。$/,
    "Tasks for $1 since this app started; these are not provider token usage or billing figures.",
  ],
];
export function t(text: string): string {
  if (language === "zh") return text;
  const result = dictionary[text];
  if (result !== undefined) return result;
  for (const [pattern, replacement] of patterns)
    if (pattern.test(text)) return text.replace(pattern, replacement);
  return text;
}
