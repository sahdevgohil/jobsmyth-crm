/**
 * Deterministic TEST/DEMO fixtures shaped like Google Solar API responses.
 * These are synthetic. They are never returned by the live adapter and must never be presented as Google results.
 */
import type { GoogleBuildingInsights } from './google-solar.adapter.js';

const center = { latitude: 30.2672, longitude: -97.7431 };

/** A small hip-and-gable house: 4 segments, ~167.7 m2 (about 18.05 roofing squares). */
export function buildingInsightsFixture(overrides: Partial<GoogleBuildingInsights> = {}): GoogleBuildingInsights {
  const seg = (az: number, pitch: number, area: number, dLat: number, dLng: number) => ({
    pitchDegrees: pitch,
    azimuthDegrees: az,
    stats: { areaMeters2: area, groundAreaMeters2: area * Math.cos((pitch * Math.PI) / 180), sunshineQuantiles: [900, 1100, 1300] },
    center: { latitude: center.latitude + dLat, longitude: center.longitude + dLng },
    boundingBox: {
      sw: { latitude: center.latitude + dLat - 0.00004, longitude: center.longitude + dLng - 0.00005 },
      ne: { latitude: center.latitude + dLat + 0.00004, longitude: center.longitude + dLng + 0.00005 },
    },
    planeHeightAtCenterMeters: 6.4,
  });
  return {
    name: 'buildings/TEST_FIXTURE_NOT_GOOGLE',
    center,
    imageryDate: { year: 2024, month: 3, day: 18 },
    imageryProcessedDate: { year: 2024, month: 9, day: 2 },
    imageryQuality: 'HIGH',
    postalCode: '78701',
    administrativeArea: 'TX',
    regionCode: 'US',
    solarPotential: {
      wholeRoofStats: { areaMeters2: 167.7, groundAreaMeters2: 150 },
      roofSegmentStats: [
        seg(0, 26.565, 55.9, 0.00003, 0),
        seg(180, 26.565, 55.9, -0.00003, 0),
        seg(90, 18.435, 27.95, 0, 0.00004),
        seg(270, 18.435, 27.95, 0, -0.00004),
      ],
    },
    ...overrides,
  };
}

/** Geocoding response body for the fixture address. */
export function geocodeFixture(precise = true): Record<string, unknown> {
  return {
    status: 'OK',
    results: [
      {
        formatted_address: '500 Example Ave, Austin, TX 78701, USA',
        place_id: 'TEST_PLACE_ID',
        partial_match: false,
        geometry: { location: { lat: center.latitude, lng: center.longitude }, location_type: precise ? 'ROOFTOP' : 'APPROXIMATE' },
        address_components: [
          { long_name: '500', short_name: '500', types: ['street_number'] },
          { long_name: 'Example Ave', short_name: 'Example Ave', types: ['route'] },
          { long_name: 'Austin', short_name: 'Austin', types: ['locality'] },
          { long_name: 'Texas', short_name: 'TX', types: ['administrative_area_level_1'] },
          { long_name: '78701', short_name: '78701', types: ['postal_code'] },
          { long_name: 'United States', short_name: 'US', types: ['country'] },
        ],
      },
    ],
  };
}
