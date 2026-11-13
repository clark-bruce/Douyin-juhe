const IV = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e];
const S3 = 'ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe';
const S4 = 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe';
const PERM = [34,44,56,61,73,29,70,45,35,49,38,66,51,68,28,48,64,47,30,71,26,55,31,69,59,40,62,63,27,72,41,74,57,52,42,39,33,67,53,43,65,46,36,24,60,32,79,80,84,85];
const GEO_PRESETS = [
  [1920, 937, 1920, 1040, 1920, 1040, 1920, 1080],
  [1366, 637, 1366, 728, 1366, 728, 1366, 768],
  [1536, 737, 1536, 824, 1536, 824, 1536, 864],
  [1440, 773, 1440, 860, 1440, 860, 1440, 900],
  [1280, 593, 1280, 680, 1280, 680, 1280, 720],
];
const GEO = GEO_PRESETS[0];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const epoch = 1721836800000;
const salt = 'dhzx';

const u32 = value => Number(value) >>> 0;
function rotl(value, count) { count &= 31; value = u32(value); return count ? u32((value << count) | (value >>> (32 - count))) : value; }
function ff(x, y, z, j) { return j < 16 ? u32(x ^ y ^ z) : u32((x & y) | (x & z) | (y & z)); }
function gg(x, y, z, j) { return j < 16 ? u32(x ^ y ^ z) : u32((x & y) | (~x & z)); }
function p0(x) { return u32(x ^ rotl(x, 9) ^ rotl(x, 17)); }
function p1(x) { return u32(x ^ rotl(x, 15) ^ rotl(x, 23)); }
function sm3Block(state, block) {
  const w = new Uint32Array(68), w1 = new Uint32Array(64);
  for (let i = 0; i < 16; i++) w[i] = block.readUInt32BE(i * 4);
  for (let j = 16; j < 68; j++) w[j] = u32(p1(w[j - 16] ^ w[j - 9] ^ rotl(w[j - 3], 15)) ^ rotl(w[j - 13], 7) ^ w[j - 6]);
  for (let j = 0; j < 64; j++) w1[j] = u32(w[j] ^ w[j + 4]);
  let [a, b, c, d, e, f, g, h] = state;
  for (let j = 0; j < 64; j++) {
    const tj = j < 16 ? 0x79cc4519 : 0x7a879d8a;
    const ss1 = rotl(u32(rotl(a, 12) + e + rotl(tj, j)), 7);
    const ss2 = u32(ss1 ^ rotl(a, 12));
    const tt1 = u32(ff(a, b, c, j) + d + ss2 + w1[j]);
    const tt2 = u32(gg(e, f, g, j) + h + ss1 + w[j]);
    d = c; c = rotl(b, 9); b = a; a = tt1; h = g; g = rotl(f, 19); f = e; e = p0(tt2);
  }
  return state.map((value, index) => u32(value ^ [a, b, c, d, e, f, g, h][index]));
}
function sm3(value) {
  const input = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value), 'utf8');
  const bitLength = BigInt(input.length) * 8n;
  const padded = Buffer.concat([input, Buffer.from([0x80]), Buffer.alloc((56 - ((input.length + 1) % 64) + 64) % 64), Buffer.alloc(8)]);
  padded.writeBigUInt64BE(bitLength, padded.length - 8);
  let state = IV.slice();
  for (let offset = 0; offset < padded.length; offset += 64) state = sm3Block(state, padded.subarray(offset, offset + 64));
  const output = Buffer.alloc(32); state.forEach((value, index) => output.writeUInt32BE(value, index * 4)); return output;
}
function customBase64(data, alphabet) {
  let output = '';
  for (let offset = 0; offset < data.length; offset += 3) {
    const length = Math.min(3, data.length - offset), b0 = data[offset] || 0, b1 = data[offset + 1] || 0, b2 = data[offset + 2] || 0;
    const value = (b0 << 16) | (b1 << 8) | b2;
    output += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63] + (length > 1 ? alphabet[(value >>> 6) & 63] : '=') + (length > 2 ? alphabet[value & 63] : '=');
  }
  return output;
}
function rc4(key, data) {
  const box = Array.from({ length: 256 }, (_, index) => 255 - index); let j = 0;
  for (let i = 0; i < 256; i++) { j = (j * box[i] + j + key[i % key.length]) % 256; [box[i], box[j]] = [box[j], box[i]]; }
  const output = [], state = { i: 0, j: 0 };
  for (const byte of data) { state.i = (state.i + 1) % 256; state.j = (state.j + box[state.i]) % 256; [box[state.i], box[state.j]] = [box[state.j], box[state.i]]; output.push(byte ^ box[(box[state.i] + box[state.j]) % 256]); }
  return output;
}
const leBytes = (value, count) => Array.from({ length: count }, (_, index) => Math.floor(Number(value) / 2 ** (8 * index)) & 255);
const strBytes = value => [...String(value)].flatMap(char => { const code = char.codePointAt(0); return code & 0xff00 ? [code >> 8, code & 255] : [code]; });
const xor = values => values.reduce((result, value) => result ^ (Array.isArray(value) ? xor(value) : value), 0);
function expand(values, random) {
  const output = [];
  for (let index = 0; index < values.length; index += 3) {
    if (index + 2 < values.length) {
      const r = Math.floor(random() * 1000) & 255;
      output.push((r & 145) | (values[index] & 110), (r & 66) | (values[index + 1] & 189), (r & 44) | (values[index + 2] & 211), (values[index] & 145) | (values[index + 1] & 66) | (values[index + 2] & 44));
    } else { output.push(values[index]); if (index + 1 < values.length && values[index + 1]) output.push(values[index + 1]); }
  }
  return output;
}
function blend(c0, c1, r0, r1) { return [(r0 & 170) | (c0 & 85), (r0 & 85) | (c0 & 170), (r1 & 170) | (c1 & 85), (r1 & 85) | (c1 & 170)]; }
function escapeDigest(digest, index, reserved, fallback, force) { let value = digest[index] ?? fallback; while (value === reserved) value = digest[++index] ?? fallback; return force ? reserved : value; }
function bucket(counter) { return counter > 10745 ? 3 : counter > 1283 ? 4 : counter > 139 ? 5 : 6; }
function browserFlags() { return 3; }
function z144Check(random, flags) {
  if (flags & 64) { const value = Math.floor(random() * 109); return value + 110 + (value % 2); }
  const value = Math.floor(random() * 240); return value > 109 ? value + (value % 2) + 1 : value;
}
function z145Permissions(random) {
  return (Math.floor(random() * 255) & 77) | 2 | 16 | 32 | 128;
}

let counter = 2;
export function generateABogus(query, body = '', userAgent = UA) {
  counter += 1;
  const now = Date.now(), random = Math.random, first = sm3(sm3(`${query}${salt}`)), second = sm3(sm3(`${body}${salt}`));
  const uaCipher = rc4([0, 129, 14], [...String(userAgent || UA)].map(char => char.charCodeAt(0))), uaHash = sm3(Buffer.from(customBase64(uaCipher, S3)));
  const flags = browserFlags(), L = {}; L[12] = 3; L[14] = now; L[23] = [3, 82]; L[24] = 41; L[25] = [1, 0, 1, 0, 1]; L[26] = Math.floor((now - epoch) / 1000 / 60 / 60 / 24 / 14); L[27] = bucket(counter); L[28] = 3;
  const nowBytes = leBytes(now, 6); for (let i = 0; i < 6; i++) L[29 + i] = nowBytes[i]; L[35] = 129; L[36] = 0; L[37] = [0, 0, 0, 0, flags]; L[38] = flags; L[39] = 0;
  for (let i = 0; i < 4; i++) L[40 + i] = 0; L[44] = 14; L[45] = 0; L[46] = 0; L[47] = 0; L[48] = first[9]; L[49] = first[18]; L[51] = escapeDigest(first, 3, 11, 12, Boolean(flags & 2)); L[52] = second[10]; L[53] = second[19]; L[55] = escapeDigest(second, 4, 8, 9, Boolean(flags & 4)); L[56] = uaHash[11]; L[57] = uaHash[21]; L[59] = escapeDigest(uaHash, 5, 12, 13, Boolean(flags & 8));
  const inkBytes = leBytes(now - 1, 6); for (let i = 0; i < 6; i++) L[60 + i] = inkBytes[i]; L[66] = L[12]; for (let i = 0; i < 4; i++) { L[67 + i] = [239, 24, 0, 0][i]; L[71 + i] = [239, 24, 0, 0][i]; }
  const geo = strBytes(`${GEO.join('|')}|Win32`); L[77] = geo; L[78] = geo.length; L[79] = geo.length & 255; L[80] = geo.length >> 8; const tail = `${(now + 3) & 255},`; L[82] = strBytes(tail); L[83] = L[82].length; L[84] = L[83] & 255; L[85] = L[83] >> 8;
  const v6 = random() * 65535; const a8 = [...blend(L[25][0], L[25][1], Math.floor(v6) & 255, Math.floor(v6 / 256) & 255)]; random(); a8.push(...blend(L[25][2], L[25][3], z144Check(random, flags), z145Permissions(random))); L[86] = a8;
  const selected = [24,26,27,28,29,30,31,32,33,34,35,36,38,39,40,41,42,43,44,45,46,47,48,49,51,52,53,55,56,57,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,79,80,84,85]; L[87] = xor([...a8, ...selected.map(index => L[index])]);
  const a98 = [...PERM.map(index => L[index]), ...L[77], ...L[82], L[87]]; const head = blend(3, 82, Math.floor(random() * 65535) & 255, Math.floor(random() * 40)); const plain = [...a8, ...expand(a98, random)];
  return customBase64([...head, ...rc4([211], plain)], S4);
}

export function sm3Hex(value) { return sm3(value).toString('hex'); }
