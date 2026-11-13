// 诊断：记录耗时较长的同步代码段（只有标签和耗时，不含任何业务内容）。
// 事件循环停顿日志只能事后告诉我们“卡了多久”，这里补上“那段时间里谁在同步占用主线程”。
const SEGMENT_MIN_MS = 250, KEEP_MS = 60_000, KEEP_MAX = 200;
const segments = [];

export function traceSync(label, fn) {
  const startedAt = Date.now();
  try { return fn(); }
  finally {
    const ms = Date.now() - startedAt;
    if (ms >= SEGMENT_MIN_MS) {
      segments.push({ label, at: startedAt, ms });
      if (segments.length > KEEP_MAX) segments.splice(0, segments.length - KEEP_MAX);
    }
  }
}

// 返回最近 windowMs 内的长同步代码段，按标签汇总：{ label, count, totalMs, maxMs }。
export function recentSegments(windowMs = 12_000) {
  const cutoff = Date.now() - Math.min(windowMs, KEEP_MS);
  const grouped = new Map();
  for (const item of segments) {
    if (item.at + item.ms < cutoff) continue;
    const entry = grouped.get(item.label) || { label: item.label, count: 0, totalMs: 0, maxMs: 0 };
    entry.count++; entry.totalMs += item.ms; entry.maxMs = Math.max(entry.maxMs, item.ms);
    grouped.set(item.label, entry);
  }
  return [...grouped.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 8);
}
