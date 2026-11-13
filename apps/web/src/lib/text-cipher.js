// 文本加密：把秘密消息按 UTF-8 转二进制，用零宽字符 U+200B(0) / U+200C(1) 藏进载体文本。
// 与桌面端「文本加密系统.exe」的编码格式一致，两边生成的密文可以互相解密。
const ZERO = '\u200B', ONE = '\u200C';
const ZW_ALL = /[\u200B\u200C]/g;
// 与桌面端 stripZeroWidth 完全一致：连 U+200D/U+200E/U+200F/U+FEFF 一并清除。
const STRIP_ALL = /[\u200B-\u200D\u200E\u200F\uFEFF]/g;

function toZeroWidth(secret) {
  const bytes = new TextEncoder().encode(secret);
  return Array.from(bytes, byte => byte.toString(2).padStart(8, '0')).join('').replace(/0/g, ZERO).replace(/1/g, ONE);
}

// 与桌面端 scatterEmbed 一致：按 UTF-16 单元计数，共 length+1 个间隙，前 remainder 个间隙多放 1 位。
function scatter(cover, sequence) {
  if (!cover.length) return sequence;
  if (!sequence.length) return cover;
  const gaps = cover.length + 1;
  const base = Math.floor(sequence.length / gaps), extra = sequence.length % gaps;
  let cursor = 0, result = '';
  for (let index = 0; index < gaps; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    result += sequence.slice(cursor, cursor + size) + (index < cover.length ? cover[index] : '');
    cursor += size;
  }
  return result;
}

export function encodeHidden(cover, secret, { mode = 'scatter', position = 'end', index = 0 } = {}) {
  if (typeof secret !== 'string' || !secret.trim()) throw new Error('秘密消息不能为空');
  const sequence = toZeroWidth(secret), base = String(cover || '');
  if (mode === 'scatter') return scatter(base, sequence);
  if (position === 'start') return sequence + base;
  if (position === 'end') return base + sequence;
  const at = Math.min(base.length, Math.max(0, Number.isFinite(Number(index)) ? Math.trunc(Number(index)) : 0));
  return base.slice(0, at) + sequence + base.slice(at);
}

export function decodeHidden(text) {
  const sequence = String(text || '').match(ZW_ALL);
  if (!sequence) throw new Error('未检测到加密字符（U+200B / U+200C）');
  const bits = sequence.map(char => (char === ONE ? '1' : '0')).join('');
  const usable = bits.slice(0, bits.length - (bits.length % 8));
  if (!usable) throw new Error('加密数据不足一个字节');
  const bytes = new Uint8Array(usable.length / 8);
  for (let offset = 0; offset < bytes.length; offset += 1) bytes[offset] = parseInt(usable.slice(offset * 8, offset * 8 + 8), 2);
  // 与桌面端一致：非严格 UTF-8 解码（无效字节显示为替换字符）。
  return new TextDecoder('utf-8').decode(bytes);
}

export const stripHidden = text => String(text || '').replace(STRIP_ALL, '');

export function inspectHidden(text) {
  const raw = String(text || ''), count = (raw.match(ZW_ALL) || []).length;
  let secret = '';
  if (count) { try { secret = decodeHidden(raw); } catch { secret = ''; } }
  return { visible: stripHidden(raw), hiddenBits: count, secret };
}

export const COVER_PRESETS = [
  '❤️💔🛐♋️💖♌️', '😀😋😐😄😊😙😅', '🍆🍠🍉🌮🍐', '🏍🚍🚞🚍🚑', '♊️🛐☮️☪️', '🐔🐵🐯🐸🦇🦄🦅', '🐧🙉🐙🦁🐝🙊',
  '🌽🥝🍅🥕🥔🥖🥨🥭', '🐜🐺🦇🐺🐞🦖🐙🦑', '🥩🍔🌭🥚🥙🧆🍟', '🍥🎂🥟🍣🍝🥘🍱', '🍹🍸🍺🍾🏈⚽️🏀🥡🥃', '🦌🐎🦮🐲🌳🍃🌲',
  '👠🧳🐽🐭🐵🐔🐸🐹', '🐂🐕🐐🦃🕊️🦨🌴🌵🐀', '🥒🍟🍔🍗🍡🍘🎂', '🌸🌗🌞🌷🔥🌟⛅️', '🧃🍶🍵🧉🏓🥢🏓', '🥌🏌️‍♀️🏇🤼🏋️',
  '🚵🏄🏊‍♀️🚵🎹🩰🚙🚗', '🚖🚔🚛🏬🏛️🏭🏤', '⏱️💷⚗️🚰🧴🎀🖼️', '🌈🌏🌎🌻🌸🐚🍄'
];
