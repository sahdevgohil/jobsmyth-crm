import { describe, expect, it } from 'vitest';
import { GoogleSolarAdapter } from '../google-solar.adapter.js';
import { renderAerialPng } from './aerial.js';
import { renderApproximateDiagram, renderDiagram } from './diagrams.js';
import { buildRoofGeometry } from './derive.js';
import { GABLE, HIP, COMPLEX, FLAT, TWO_BUILDINGS, makeRasters, roofOf, FIXTURE_CENTER_XY } from './fixtures.js';
import { readGeoTiff } from './geotiff-reader.js';
import { latLngToXY, xyToLatLng } from './raster.js';
import { writeGeoTiff } from './tiff-fixture.js';

describe('GeoTIFF reading', () => {
  it('round-trips georeferencing and pixel values for RGB, DSM and mask files', async () => {
    const set = makeRasters(GABLE);
    const dsm = await readGeoTiff(writeGeoTiff(set.dsm, 'dsm'));
    const mask = await readGeoTiff(writeGeoTiff(set.mask, 'mask'));
    const rgb = await readGeoTiff(writeGeoTiff(set.rgb!, 'rgb'));
    expect(dsm).toMatchObject({ width: set.dsm.width, height: set.dsm.height, epsg: 32614, pixel: 0.25, originX: set.dsm.originX, originY: set.dsm.originY });
    expect(rgb.bands).toHaveLength(3);
    expect(mask.nodata[0]).toBe(0);
    const i = 150 * dsm.width + 190;
    expect(dsm.bands[0]![i]).toBeCloseTo(set.dsm.bands[0]![i] as number, 3);
    expect(mask.bands[0]![i]).toBe(set.mask.bands[0]![i]);
  });

  it('rejects files that are not GeoTIFFs', async () => {
    await expect(readGeoTiff(new TextEncoder().encode('not a tiff at all, just text').buffer as ArrayBuffer)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('converts between latitude/longitude and the raster CRS', () => {
    const ll = xyToLatLng(32614, FIXTURE_CENTER_XY[0], FIXTURE_CENTER_XY[1]);
    const [x, y] = latLngToXY(32614, ll.latitude, ll.longitude);
    expect(x).toBeCloseTo(FIXTURE_CENTER_XY[0], 2);
    expect(y).toBeCloseTo(FIXTURE_CENTER_XY[1], 2);
    expect(ll.latitude).toBeGreaterThan(30);
    expect(ll.latitude).toBeLessThan(31);
  });
});

describe('Data Layers download protections', () => {
  const ok = (body: ArrayBuffer | string, status = 200, headers: Record<string, string> = {}): Response => new Response(body, { status, headers });
  const adapter = (impl: typeof fetch) => new GoogleSolarAdapter({ apiKey: 'TEST-KEY-123', fetchImpl: impl, timeoutMs: 500 });

  it('only downloads from solar.googleapis.com over https, and adds the key server-side', async () => {
    const seen: string[] = [];
    const a = adapter(async (u) => { seen.push(String(u)); return ok(new ArrayBuffer(64)); });
    await a.downloadGeoTiff('https://solar.googleapis.com/v1/solar/geoTiff:get?id=abc');
    expect(seen[0]).toContain('id=abc');
    expect(seen[0]).toContain('key=TEST-KEY-123');
    for (const bad of ['http://solar.googleapis.com/v1/x', 'https://evil.example.com/steal?x=1', 'https://solar.googleapis.com.evil.com/x', 'not a url']) {
      await expect(a.downloadGeoTiff(bad)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    }
    expect(seen).toHaveLength(1); // the key was never sent anywhere else
  });

  it('refuses oversized responses', async () => {
    const a = adapter(async () => ok(new ArrayBuffer(2000), 200, { 'content-length': '2000' }));
    await expect(a.downloadGeoTiff('https://solar.googleapis.com/v1/solar/geoTiff:get?id=x', { maxBytes: 1000 })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('retries server errors and network failures, but not rejected requests', async () => {
    let calls = 0;
    const flaky = adapter(async () => { calls += 1; return calls < 3 ? ok('{}', 503) : ok(new ArrayBuffer(64)); });
    await expect(flaky.downloadGeoTiff('https://solar.googleapis.com/v1/solar/geoTiff:get?id=x')).resolves.toBeInstanceOf(ArrayBuffer);
    expect(calls).toBe(3);
    let denied = 0;
    const forbidden = adapter(async () => { denied += 1; return ok(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'billing' } }), 403); });
    await expect(forbidden.downloadGeoTiff('https://solar.googleapis.com/v1/solar/geoTiff:get?id=x')).rejects.toMatchObject({ code: 'BILLING_DISABLED' });
    expect(denied).toBe(1);
    const down = adapter(async () => { throw new TypeError('fetch failed'); });
    await expect(down.downloadGeoTiff('https://solar.googleapis.com/v1/solar/geoTiff:get?id=x')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('aerial image and vector diagrams', () => {
  const geometry = (spec = GABLE) => {
    const roof = roofOf(spec);
    const set = makeRasters(spec);
    const g = buildRoofGeometry({ rasters: set, roof, center: roof.buildingCenter! });
    return { roof, set, g };
  };

  it('crops the aerial raster without stretching it and keeps the geographic extent', () => {
    const { set, g } = geometry();
    const pts = g.structures[0]!.footprint;
    const focus = { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
    const a = renderAerialPng(set.rgb!, { cx: g.frame.cx, cy: g.frame.cy }, focus, 6)!;
    expect(a.png.subarray(1, 4).toString()).toBe('PNG');
    const ratioPx = a.imagery.widthPx / a.imagery.heightPx;
    const ratioM = (a.imagery.extent.maxX - a.imagery.extent.minX) / (a.imagery.extent.maxY - a.imagery.extent.minY);
    expect(ratioPx).toBeCloseTo(ratioM, 1);
    expect(a.imagery.extent.maxX - a.imagery.extent.minX).toBeGreaterThanOrEqual(12 + 10);
  });

  it.each([['gable', GABLE], ['hip', HIP], ['complex', COMPLEX], ['flat', FLAT], ['two structures', TWO_BUILDINGS]] as const)('draws all five diagrams for a %s roof from real geometry', (_n, spec) => {
    const { g } = geometry(spec);
    for (const kind of ['outline', 'facets', 'area', 'pitch', 'edges'] as const) {
      const svg = renderDiagram(g, kind);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('>N</text>'); // north arrow
      expect(svg).toContain('ft</text>'); // scale bar
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      if (kind !== 'outline') for (const f of g.facets) expect(svg).toContain(`>${f.id}</text>`);
    }
    expect(renderDiagram(g, 'area')).toMatch(/Facet areas in square feet/);
    expect(renderDiagram(g, 'area', { bare: true })).toMatch(/>\d[\d,]*<\/text>/);
    expect(renderDiagram(g, 'pitch')).toMatch(/\d+°/);
  });

  it('edge diagram colours edges by type, with lengths and a legend', () => {
    const { g } = geometry(GABLE);
    const svg = renderDiagram(g, 'edges');
    expect(svg).toContain('#c32930'); // ridge
    expect(svg).toContain('#2f855a'); // eave
    expect(svg).toMatch(/\d+ ft<\/text>/);
    expect(svg).toContain('>Ridge</text>');
  });

  it('the approximate fallback says so loudly and never claims to be an outline', () => {
    const { roof } = geometry();
    const svg = renderApproximateDiagram(roof.segments);
    expect(svg).toContain('APPROXIMATE');
    expect(svg).toContain('not the true roof shape');
    expect(svg).not.toContain('Roof outline<');
  });

  it('an XML-significant character in labels cannot break the markup', () => {
    const { g } = geometry();
    g.structures[0]!.id = 'ST<1>&';
    g.structures.push({ ...g.structures[0]!, id: 'X<&>"', kind: 'additional' });
    expect(() => renderDiagram(g, 'outline')).not.toThrow();
    expect(renderDiagram(g, 'outline')).toContain('X&lt;&amp;&gt;&quot; (outline only)');
  });
});
