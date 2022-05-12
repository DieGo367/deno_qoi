interface Color {
	r: number;
	g: number;
	b: number;
	a: number;
}
export interface DecodedImage {
	data: Uint8Array,
	width: number,
	height: number,
	channels: Channels,
	colorspace: ColorSpace
}

export enum Channels {
	RGB = 3,
	RGBA = 4
}
export enum ColorSpace {
	sRGB = 0, // with linear alpha
	linear = 1 // all channels linear
}
enum OP {
	RGB   = 0b11111110,
	RGBA  = 0b11111111,
	INDEX = 0b00000000,
	DIFF  = 0b01000000,
	LUMA  = 0b10000000,
	RUN   = 0b11000000
}

class QOI {
	buffer: ArrayBuffer;
	#magic: Uint8Array;
	#header: DataView;
	readonly data: DataView;
	readonly dataLength: number;
	#EOF: DataView;
	constructor(buffer: ArrayBuffer);
	constructor(dataSize: number);
	constructor(bs: ArrayBuffer | number) {
		if (typeof bs === "number") this.buffer = new ArrayBuffer(4 + 4 + 4 + 1 + 1 + bs + 8);
		else this.buffer = bs;
		this.#magic = new Uint8Array(this.buffer, 0, 4);
		this.#header = new DataView(this.buffer, 0, 4+4+4+1+1);
		this.dataLength = this.buffer.byteLength - 14 - 8;
		let view = new DataView(this.buffer, 14);
		for (let i = 0; i < view.byteLength - 7; i++) {
			if (view.getBigInt64(i, false) === 1n) {
				this.dataLength = i;
				break;
			}
		}
		this.data = new DataView(this.buffer, 14, this.dataLength);
		this.#EOF = new DataView(this.buffer, 14 + this.dataLength, 8);
	}
	get magic(): string { return new TextDecoder().decode(this.#magic); }
	get width(): number { return this.#header.getUint32(4, false); }
	get height(): number { return this.#header.getUint32(8, false); }
	get channels(): number { return this.#header.getUint8(12); }
	get colorspace(): number { return this.#header.getUint8(13); }
	get EOF(): bigint { return this.#EOF.getBigUint64(0, false); }
	get(i: number): number { return this.data.getUint8(i); }
	set magic(str: string) { new TextEncoder().encodeInto(str, this.#magic); }
	set width(n: number) { this.#header.setUint32(4, n, false); }
	set height(n: number) { this.#header.setUint32(8, n, false); }
	set channels(n: Channels) { this.#header.setUint8(12, n); }
	set colorspace(n: ColorSpace) { this.#header.setUint8(13, n); }
	set EOF(bn: bigint) { this.#EOF.setBigUint64(0, bn, false); }
	set(i: number, n: number) { this.data.setUint8(i, n); }
}

export class QOIEncodeError extends Error {}
export class QOIDecodeError extends Error {}

function i8(n: number) {
	while (n < -128) n += 256;
	while (n > 127) n -= 256;
	return n;
}
function colorsEqual(a: Color, b: Color) {
	return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
function colorHash(color: Color) {
	return (color.r * 3 + color.g * 5 + color.b * 7 + color.a * 11) % 64;
}
function bounds(min: number, test: number, max: number) {
	return min <= test && test <= max;
}

export function encode(data: Uint8Array, width: number, height: number, channels?: Channels, colorspace?: ColorSpace): Uint8Array;
export function encode(data: DecodedImage): Uint8Array;
export function encode(data: Uint8Array | DecodedImage, width?: number, height?: number, channels: Channels = Channels.RGBA, colorspace: ColorSpace = ColorSpace.sRGB): Uint8Array {
	if (!(data instanceof Uint8Array)) {
		({data, width, height, channels, colorspace} = data);
	}
	if (data.byteLength < channels * width! * height!)
		throw new QOIEncodeError("Data size is too small.");
	if (channels < 3 || channels > 4)
		throw new QOIEncodeError("Unsupported channel count.");

	const output: number[] = [];
	let previous = {r: 0, g: 0, b: 0, a: 255};
	const seen: (Color | undefined)[] = [];
	const doAlpha = channels === Channels.RGBA;
	let run = 0;

	for (let i = 0; i < data.length; i += channels) {
		const color = {
			r: data[i], g: data[i+1], b: data[i+2],
			a: doAlpha ? data[i+3] : 255
		};
		const index = colorHash(color);
		if (colorsEqual(color, previous)) {
			run++;
			if (run === 62) {
				output.push(OP.RUN | (run-1));
				run = 0;
			}
		}
		else {
			if (run > 0) {
				output.push(OP.RUN | (run-1));
				run = 0;
			}
			const stored = seen[index] ?? {r: 0, g: 0, b: 0, a: 0};
			if (colorsEqual(color, stored)) {
				output.push(OP.INDEX | index);
			}
			else if (color.a === previous.a) {
				const dr = i8(color.r - previous.r);
				const dg = i8(color.g - previous.g);
				const db = i8(color.b - previous.b);
				const dr_dg = i8(dr - dg);
				const db_dg = i8(db - dg);
				if (bounds(-2, dr, 1) && bounds(-2, dg, 1) && bounds(-2, db, 1)) {
					output.push(OP.DIFF | (dr+2) << 4 | (dg+2) << 2 | (db+2));
				}
				else if (bounds(-32, dg, 31) && bounds(-8, dr_dg, 7) && bounds(-8, db_dg, 7)) {
					output.push(OP.LUMA | (dg+32));
					output.push((dr_dg+8) << 4 | (db_dg+8));
				}
				else {
					output.push(OP.RGB);
					output.push(color.r);
					output.push(color.g);
					output.push(color.b);
				}
			}
			else {
				output.push(OP.RGBA);
				output.push(color.r);
				output.push(color.g);
				output.push(color.b);
				output.push(color.a);
			}
		}
		seen[index] = previous = color;
	}
	if (run > 0) output.push(OP.RUN | (run-1));

	const qoi = new QOI(output.length);
	qoi.magic = "qoif";
	qoi.width = width!;
	qoi.height = height!;
	qoi.channels = channels;
	qoi.colorspace = colorspace;
	for (let i = 0; i < output.length; i++) {
		qoi.set(i, output[i]);
	}
	qoi.EOF = 1n;
	return new Uint8Array(qoi.buffer);
}

export function decode(qoi: Uint8Array): DecodedImage {
	if (qoi.byteLength < 22)
		throw new QOIDecodeError("Data size is too small to be a QOI.");
	const input = new QOI(qoi.buffer);
	if (input.magic !== "qoif")
		throw new QOIDecodeError("Not a QOI image.");
	if (input.EOF !== 1n)
		throw new QOIDecodeError("Bad file ending.");
	if (input.channels < 3 || input.channels > 4)
		throw new QOIDecodeError("Unsupported channel count.");

	const output = new Uint8Array(input.channels * input.width * input.height);
	let previous = {r: 0, g: 0, b: 0, a: 255};
	const seen: (Color | undefined)[] = [];
	const doAlpha = input.channels === Channels.RGBA;
	let o = 0;

	for (let i = 0; i < input.dataLength; i++) {
		const byte = input.get(i);
		let op = byte;
		if (op === OP.RGB) {
			previous.r = output[o++] = input.get(++i);
			previous.g = output[o++] = input.get(++i);
			previous.b = output[o++] = input.get(++i);
			if (doAlpha) output[o++] = previous.a;
		}
		else if (op === OP.RGBA) {
			previous.r = output[o++] = input.get(++i);
			previous.g = output[o++] = input.get(++i);
			previous.b = output[o++] = input.get(++i);
			if (doAlpha) previous.a = output[o++] = input.get(++i);
		}
		else {
			op = op & 0b11000000;
			if (op === OP.INDEX) {
				const index = byte & 0b00111111;
				const stored = seen[index] ?? {r: 0, g: 0, b: 0, a: 0};
				previous.r = output[o++] = stored.r;
				previous.g = output[o++] = stored.g;
				previous.b = output[o++] = stored.b;
				if (doAlpha) previous.a = output[o++] = stored.a;
			}
			else if (op === OP.DIFF) {
				const dr = ((byte & 0b00110000) >> 4) - 2; // -2..1
				const dg = ((byte & 0b00001100) >> 2) - 2;
				const db =  (byte & 0b00000011)       - 2;
				previous.r = output[o++] = i8(previous.r + dr);
				previous.g = output[o++] = i8(previous.g + dg);
				previous.b = output[o++] = i8(previous.b + db);
				if (doAlpha) output[o++] = previous.a;
			}
			else if (op === OP.LUMA) {
				const dg = (byte & 0b00111111) - 32; // -32..31
				const next = input.get(++i);
				const dr_dg = ((next & 0b11110000) >> 4) - 8; // -8..7
				const db_dg =  (next & 0b00001111)       - 8;
				const dr = dr_dg + dg;
				const db = db_dg + dg;
				previous.r = output[o++] = i8(previous.r + dr);
				previous.g = output[o++] = i8(previous.g + dg);
				previous.b = output[o++] = i8(previous.b + db);
				if (doAlpha) output[o++] = previous.a;
			}
			else if (op === OP.RUN) {
				const runLength = (byte & 0b00111111) + 1; // 1..62
				for (let j = 0; j < runLength; j++) {
					output[o++] = previous.r;
					output[o++] = previous.g;
					output[o++] = previous.b;
					if (doAlpha) output[o++] = previous.a;
				}
			}
		}
		seen[colorHash(previous)] = {...previous};
	}	
	if (o < input.channels * input.width * input.height)
		throw new QOIDecodeError("Ran out of pixel data.");

	return {data: output, width: input.width, height: input.height, channels: input.channels, colorspace: input.colorspace};
}