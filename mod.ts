export * from "./qoi.ts";
import {encode, decode, DecodedImage, Channels, ColorSpace} from "./qoi.ts";

export async function readFile(filename: string): Promise<DecodedImage> {
	return decode(await Deno.readFile(filename));
}
export async function writeFile(filename: string, data: Uint8Array, width: number, height: number, channels?: Channels, colorspace?: ColorSpace): Promise<void>;
export async function writeFile(filename: string, image: DecodedImage): Promise<void>;
export async function writeFile(filename: string, data: Uint8Array | DecodedImage, width?: number, height?: number, channels?: Channels, colorspace?: ColorSpace): Promise<void> {
	return await Deno.writeFile(filename, encode(data as unknown as Uint8Array, width!, height!, channels, colorspace));
}