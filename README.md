# Deno QOI
An encoder/decoder for the [QOI format](https://qoiformat.org/), written in TypeScript.

## Importing
 - For Deno, import as usual from `https://deno.land/x/qoi/mod.ts`.
 - This module works in the browser too, albeit without the readFile and writeFile methods. Import directly from `https://cdn.deno.land/qoi/versions/0.1.2/raw/qoi.js`.


## Usage
### Encode / decode
```ts
import { encode, decode } from "https://deno.land/x/qoi/mod.ts";

// encode a 1x4 image consisting of 1 red, 1 green, 1 blue, and 1 black pixel
const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]);
const encodedImage = encode(data, 1, 4);

// decode from QOI data
const decodedImage = decode(encodedImage);

// you can also re-encode a decoded image
const reencodedImage = encode(decodedImage);
```

### Read / write files
```ts
import { readFile, writeFile } from "https://deno.land/x/qoi/mod.ts";

// read a QOI file as RGBA data
const image = await readFile("image.qoi");

// write the previous example image to a QOI file
const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]);
await writeFile("image.qoi", data, 1, 4);

// write a DecodedImage to a QOI file
await writeFile("image.qoi", image);
```

## See also
 - The [QOI format specification](https://qoiformat.org/qoi-specification.pdf)
 - [Dominic Szablewski](http://twitter.com/phoboslab) ([phoboslab.org](http://phoboslab.org/)) - creator of the QOI format.
