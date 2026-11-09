export const DISCLAIMER = 'These are reported weather events from NOAA. A report near a property does not show that the property was struck or damaged. Confirm damage with an inspection.';

export const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
