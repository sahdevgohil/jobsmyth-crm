import { fromArrayBuffer } from 'geotiff';
import { SolarError } from '../errors.js';
import type { GeoRaster } from './raster.js';
import { utmDefinition } from './raster.js';

/** Largest raster we are willing to decode (pixels). Guards memory: 4 bands of 16M pixels is already ~250 MB. */
export const MAX_RASTER_PIXELS = 16_000_000;

/**
 * Decodes a Google Solar GeoTIFF (RGB, DSM or mask) into a {@link GeoRaster}.
 * Rejects rasters without a supported projected CRS, with non-square pixels, or that are too large.
 */
export async function readGeoTiff(buffer: ArrayBuffer): Promise<GeoRaster> {
  let image;
  try {
    image = await (await fromArrayBuffer(buffer)).getImage();
  } catch {
    throw new SolarError('BAD_RESPONSE');
  }
  const width = image.getWidth();
  const height = image.getHeight();
  if (width * height > MAX_RASTER_PIXELS || width < 2 || height < 2) throw new SolarError('BAD_RESPONSE');
  const keys = image.getGeoKeys() as { ProjectedCSTypeGeoKey?: number } | null;
  const epsg = keys?.ProjectedCSTypeGeoKey ?? 0;
  if (!epsg || !utmDefinition(epsg)) throw new SolarError('BAD_RESPONSE');
  const [originX, originY] = image.getOrigin() as [number, number, number];
  const [resX, resY] = image.getResolution() as [number, number, number];
  if (!(Math.abs(resX) > 0) || Math.abs(Math.abs(resX) - Math.abs(resY)) > 1e-6) throw new SolarError('BAD_RESPONSE');
  const rasters = (await image.readRasters()) as unknown as ArrayLike<number>[] & { length: number };
  const nodata = image.getGDALNoData();
  const bands: ArrayLike<number>[] = [];
  for (let i = 0; i < rasters.length; i++) bands.push(rasters[i] as ArrayLike<number>);
  return { width, height, originX, originY, pixel: Math.abs(resX), epsg, bands, nodata: bands.map(() => (nodata === null || nodata === undefined ? null : Number(nodata))) };
}
