export var Channels;
(function (Channels) {
    Channels[Channels["RGB"] = 3] = "RGB";
    Channels[Channels["RGBA"] = 4] = "RGBA";
})(Channels || (Channels = {}));
export var ColorSpace;
(function (ColorSpace) {
    ColorSpace[ColorSpace["sRGB"] = 0] = "sRGB";
    ColorSpace[ColorSpace["linear"] = 1] = "linear"; // all channels linear
})(ColorSpace || (ColorSpace = {}));
var OP;
(function (OP) {
    OP[OP["RGB"] = 254] = "RGB";
    OP[OP["RGBA"] = 255] = "RGBA";
    OP[OP["INDEX"] = 0] = "INDEX";
    OP[OP["DIFF"] = 64] = "DIFF";
    OP[OP["LUMA"] = 128] = "LUMA";
    OP[OP["RUN"] = 192] = "RUN";
})(OP || (OP = {}));
class QOI {
    buffer;
    #magic;
    #header;
    data;
    dataLength;
    #EOF;
    constructor(bs) {
        if (typeof bs === "number")
            this.buffer = new ArrayBuffer(4 + 4 + 4 + 1 + 1 + bs + 8);
        else
            this.buffer = bs;
        this.#magic = new Uint8Array(this.buffer, 0, 4);
        this.#header = new DataView(this.buffer, 0, 4 + 4 + 4 + 1 + 1);
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
    get magic() { return new TextDecoder().decode(this.#magic); }
    get width() { return this.#header.getUint32(4, false); }
    get height() { return this.#header.getUint32(8, false); }
    get channels() { return this.#header.getUint8(12); }
    get colorspace() { return this.#header.getUint8(13); }
    get EOF() { return this.#EOF.getBigUint64(0, false); }
    get(i) { return this.data.getUint8(i); }
    set magic(str) { new TextEncoder().encodeInto(str, this.#magic); }
    set width(n) { this.#header.setUint32(4, n, false); }
    set height(n) { this.#header.setUint32(8, n, false); }
    set channels(n) { this.#header.setUint8(12, n); }
    set colorspace(n) { this.#header.setUint8(13, n); }
    set EOF(bn) { this.#EOF.setBigUint64(0, bn, false); }
    set(i, n) { this.data.setUint8(i, n); }
}
export class QOIEncodeError extends Error {
}
export class QOIDecodeError extends Error {
}
function i8(n) {
    while (n < -128)
        n += 256;
    while (n > 127)
        n -= 256;
    return n;
}
function colorsEqual(a, b) {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
function colorHash(color) {
    return (color.r * 3 + color.g * 5 + color.b * 7 + color.a * 11) % 64;
}
function bounds(min, test, max) {
    return min <= test && test <= max;
}
export function encode(data, width, height, channels = Channels.RGBA, colorspace = ColorSpace.sRGB) {
    if (!(data instanceof Uint8Array)) {
        ({ data, width, height, channels, colorspace } = data);
    }
    if (data.byteLength < channels * width * height)
        throw new QOIEncodeError("Data size is too small.");
    if (channels < 3 || channels > 4)
        throw new QOIEncodeError("Unsupported channel count.");
    const output = [];
    let previous = { r: 0, g: 0, b: 0, a: 255 };
    const seen = [];
    const doAlpha = channels === Channels.RGBA;
    let run = 0;
    for (let i = 0; i < data.length; i += channels) {
        const color = {
            r: data[i], g: data[i + 1], b: data[i + 2],
            a: doAlpha ? data[i + 3] : 255
        };
        const index = colorHash(color);
        if (colorsEqual(color, previous)) {
            run++;
            if (run === 62) {
                output.push(OP.RUN | (run - 1));
                run = 0;
            }
        }
        else {
            if (run > 0) {
                output.push(OP.RUN | (run - 1));
                run = 0;
            }
            const stored = seen[index] ?? { r: 0, g: 0, b: 0, a: 0 };
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
                    output.push(OP.DIFF | (dr + 2) << 4 | (dg + 2) << 2 | (db + 2));
                }
                else if (bounds(-32, dg, 31) && bounds(-8, dr_dg, 7) && bounds(-8, db_dg, 7)) {
                    output.push(OP.LUMA | (dg + 32));
                    output.push((dr_dg + 8) << 4 | (db_dg + 8));
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
    if (run > 0)
        output.push(OP.RUN | (run - 1));
    const qoi = new QOI(output.length);
    qoi.magic = "qoif";
    qoi.width = width;
    qoi.height = height;
    qoi.channels = channels;
    qoi.colorspace = colorspace;
    for (let i = 0; i < output.length; i++) {
        qoi.set(i, output[i]);
    }
    qoi.EOF = 1n;
    return new Uint8Array(qoi.buffer);
}
export function decode(qoi) {
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
    let previous = { r: 0, g: 0, b: 0, a: 255 };
    const seen = [];
    const doAlpha = input.channels === Channels.RGBA;
    let o = 0;
    for (let i = 0; i < input.dataLength; i++) {
        const byte = input.get(i);
        let op = byte;
        if (op === OP.RGB) {
            previous.r = output[o++] = input.get(++i);
            previous.g = output[o++] = input.get(++i);
            previous.b = output[o++] = input.get(++i);
            if (doAlpha)
                output[o++] = previous.a;
        }
        else if (op === OP.RGBA) {
            previous.r = output[o++] = input.get(++i);
            previous.g = output[o++] = input.get(++i);
            previous.b = output[o++] = input.get(++i);
            if (doAlpha)
                previous.a = output[o++] = input.get(++i);
        }
        else {
            op = op & 0b11000000;
            if (op === OP.INDEX) {
                const index = byte & 0b00111111;
                const stored = seen[index] ?? { r: 0, g: 0, b: 0, a: 0 };
                previous.r = output[o++] = stored.r;
                previous.g = output[o++] = stored.g;
                previous.b = output[o++] = stored.b;
                if (doAlpha)
                    previous.a = output[o++] = stored.a;
            }
            else if (op === OP.DIFF) {
                const dr = ((byte & 0b00110000) >> 4) - 2; // -2..1
                const dg = ((byte & 0b00001100) >> 2) - 2;
                const db = (byte & 0b00000011) - 2;
                previous.r = output[o++] = i8(previous.r + dr);
                previous.g = output[o++] = i8(previous.g + dg);
                previous.b = output[o++] = i8(previous.b + db);
                if (doAlpha)
                    output[o++] = previous.a;
            }
            else if (op === OP.LUMA) {
                const dg = (byte & 0b00111111) - 32; // -32..31
                const next = input.get(++i);
                const dr_dg = ((next & 0b11110000) >> 4) - 8; // -8..7
                const db_dg = (next & 0b00001111) - 8;
                const dr = dr_dg + dg;
                const db = db_dg + dg;
                previous.r = output[o++] = i8(previous.r + dr);
                previous.g = output[o++] = i8(previous.g + dg);
                previous.b = output[o++] = i8(previous.b + db);
                if (doAlpha)
                    output[o++] = previous.a;
            }
            else if (op === OP.RUN) {
                const runLength = (byte & 0b00111111) + 1; // 1..62
                for (let j = 0; j < runLength; j++) {
                    output[o++] = previous.r;
                    output[o++] = previous.g;
                    output[o++] = previous.b;
                    if (doAlpha)
                        output[o++] = previous.a;
                }
            }
        }
        seen[colorHash(previous)] = { ...previous };
    }
    if (o < input.channels * input.width * input.height)
        throw new QOIDecodeError("Ran out of pixel data.");
    return { data: output, width: input.width, height: input.height, channels: input.channels, colorspace: input.colorspace };
}
