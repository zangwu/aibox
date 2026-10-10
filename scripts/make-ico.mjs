import * as fs from 'node:fs';

/** 生成 PNG 内嵌式 ICO（Vista+ 支持），避免依赖外部转换工具 */
const png = fs.readFileSync('build/icon.png');
if (png.length === 0) throw new Error('build/icon.png 为空');

const width = 256;
const height = 256;

// ICONDIR: reserved(2) + type(2=icon) + count(2)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

// ICONDIRENTRY: w, h, colors(0), reserved(0), planes(1), bitCount(32), bytesInRes, imageOffset(22)
const entry = Buffer.alloc(16);
entry.writeUInt8(width >= 256 ? 0 : width, 0);
entry.writeUInt8(height >= 256 ? 0 : height, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);

fs.writeFileSync('build/icon.ico', Buffer.concat([header, entry, png]));
console.log(`build/icon.ico written (${png.length} png embedded)`);
