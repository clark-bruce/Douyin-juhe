// 转人工与联系方式检测。只依赖文本，便于单独测试。

// 手机号：11 位，或 3-4-4 用 "-"/空格分隔；前后不能紧邻其它数字。
const phonePattern = /(?<!\d)1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/;
// 微信号：必须带"微信/vx/wx"等关键词，微信号以字母开头，6-20 位字母数字下划线或短横线。
const wechatPattern = /(?:微信号?|薇信|v信|vx|wx|weixin|wechat)\s*(?:号|是|为|[:：=])?\s*[:：]?\s*([a-zA-Z][a-zA-Z0-9_-]{5,19})(?![a-zA-Z0-9_-])/i;
// QQ：必须带 QQ 关键词，5-11 位数字，首位非 0。
const qqPattern = /(?:qq|扣扣)\s*(?:号|号码|是|为|[:：=])?\s*[:：]?\s*([1-9]\d{4,10})(?!\d)/i;

const handoffWording = /转人工|转接人工|人工客服|联系客服|为您转接/;

export function detectContact(text) {
  const value = String(text || '');
  if (!value) return null;
  if (phonePattern.test(value)) return 'phone';
  if (wechatPattern.test(value)) return 'wechat';
  if (qqPattern.test(value)) return 'qq';
  return null;
}

export function detectHandoffWording(text) {
  return handoffWording.test(String(text || ''));
}
