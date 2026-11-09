import { round, sqFtToSquares } from './geo.js';

/** Percentages accepted when choosing a waste factor. */
export const WASTE_PERCENTS = [0, 5, 10, 12, 14, 15, 17, 20, 22] as const;
/** Columns printed in the report: shingled (pitched) roofs and flat roofs use different scenarios. */
export const PITCHED_WASTE = [0, 10, 12, 14, 15, 17, 20] as const;
export const FLAT_WASTE = [0, 10, 12, 15, 17, 20, 22] as const;
/** Waste columns used by the material table. */
export const MATERIAL_WASTE_COLUMNS = [0, 10, 14, 15] as const;
const DEFAULT_TABLE = [0, 5, 10, 12, 14, 15, 17, 20] as const;

export type WasteRow = {
  percent: number;
  baseAreaSqFt: number;
  wasteAreaSqFt: number;
  finalAreaSqFt: number;
  baseSquares: number;
  finalSquares: number;
};

/**
 * Material-ordering waste table. Waste is applied ONCE to the base roof area.
 * Do not feed the final area into the customer price catalog: its shingle rates already include waste.
 */
export function wasteTable(baseAreaSqFt: number, percents: readonly number[] = DEFAULT_TABLE): WasteRow[] {
  return percents.map((percent) => {
    const wasteAreaSqFt = (baseAreaSqFt * percent) / 100;
    const finalAreaSqFt = baseAreaSqFt + wasteAreaSqFt;
    return {
      percent,
      baseAreaSqFt: round(baseAreaSqFt),
      wasteAreaSqFt: round(wasteAreaSqFt),
      finalAreaSqFt: round(finalAreaSqFt),
      baseSquares: round(sqFtToSquares(baseAreaSqFt)),
      finalSquares: round(sqFtToSquares(finalAreaSqFt)),
    };
  });
}
