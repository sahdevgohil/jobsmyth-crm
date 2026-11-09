export const SOLAR_ERROR_CODES = [
  'NOT_CONFIGURED',
  'NOT_FOUND',
  'INVALID_COORDINATES',
  'NO_ROOF_DATA',
  'AUTH_FAILED',
  'KEY_RESTRICTED',
  'API_DISABLED',
  'BILLING_DISABLED',
  'QUOTA_EXCEEDED',
  'LIMIT_REACHED',
  'TIMEOUT',
  'NETWORK',
  'BAD_RESPONSE',
  'GEOCODE_NO_RESULT',
  'ADDRESS_NOT_PRECISE',
  'DISABLED',
] as const;
export type SolarErrorCode = (typeof SOLAR_ERROR_CODES)[number];

/** Safe, user-facing explanations. Provider error bodies are never passed through. */
export const SOLAR_ERROR_MESSAGES: Record<SolarErrorCode, string> = {
  NOT_CONFIGURED: 'Google Solar is not configured on the server. Enter the measurement manually or ask an administrator to set it up.',
  NOT_FOUND: 'Google has no roof data for this location at the requested quality.',
  INVALID_COORDINATES: 'The coordinates for this address are not valid. Check the address and try again.',
  NO_ROOF_DATA: 'Google returned a building but no usable roof segment data.',
  AUTH_FAILED: 'Google rejected the server API key or denied permission. An administrator must check the key.',
  KEY_RESTRICTED: 'The API key is restricted in a way that blocks this server (IP address or API restriction).',
  API_DISABLED: 'The Solar API (or Geocoding API) is not enabled for the Google Cloud project.',
  BILLING_DISABLED: 'Billing is not enabled on the Google Cloud project. Google requires a billing account even within the free allowance.',
  QUOTA_EXCEEDED: 'Google reports the request quota is exceeded. Try again later or enter the measurement manually.',
  LIMIT_REACHED: 'The configured usage limit for Google requests has been reached.',
  TIMEOUT: 'Google did not respond in time. Try again shortly.',
  NETWORK: 'Could not reach Google. Check the server connection and try again.',
  BAD_RESPONSE: 'Google returned a response the CRM could not understand. Nothing was saved.',
  GEOCODE_NO_RESULT: 'No matching address was found. Check the spelling or enter the address manually.',
  ADDRESS_NOT_PRECISE: 'The address could only be located approximately. Confirm the pin location before measuring.',
  DISABLED: 'Automated measurements are turned off for this company.',
};

export class SolarError extends Error {
  readonly code: SolarErrorCode;
  readonly httpStatus?: number;
  constructor(code: SolarErrorCode, httpStatus?: number) {
    super(SOLAR_ERROR_MESSAGES[code]);
    this.name = 'SolarError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** What an administrator should do about each failure. Shown on the integration page; never contains secrets. */
export const SOLAR_ADMIN_FIX: Record<SolarErrorCode, string> = {
  NOT_CONFIGURED: 'Add GOOGLE_SOLAR_API_KEY to backend/.env and restart the backend.',
  NOT_FOUND: 'Google had no data for the test location. Try again; if it persists, check that the key belongs to a project with the Solar API enabled.',
  INVALID_COORDINATES: 'The test coordinates were rejected. Report this as a bug.',
  NO_ROOF_DATA: 'Google answered, but without usable roof data. Try again later.',
  AUTH_FAILED: 'In Google Cloud > APIs & Services > Credentials, confirm the key value in backend/.env is correct and belongs to the project where Solar API is enabled.',
  KEY_RESTRICTED: 'In Credentials > your key > Application restrictions, allow the outbound IP address of this server (or remove the restriction while testing). Under API restrictions, include Solar API and Geocoding API.',
  API_DISABLED: 'In Google Cloud > APIs & Services > Library, enable "Solar API" (solar.googleapis.com) for the same project as the key. Enable "Geocoding API" too if you use address lookup.',
  BILLING_DISABLED: 'Link an active billing account to the Google Cloud project (Billing > Link a billing account). Google requires it even within the free allowance.',
  QUOTA_EXCEEDED: 'Wait and retry, or raise the quota in Google Cloud > IAM & Admin > Quotas.',
  LIMIT_REACHED: 'The CRM usage limit was reached. Raise it under Measurements > Integration & usage.',
  TIMEOUT: 'Google did not answer in time. Check the server internet connection and retry.',
  NETWORK: 'The server could not reach Google. Check outbound internet access, proxy and firewall settings.',
  BAD_RESPONSE: 'Google returned something unexpected. Retry; if it persists, check Google Cloud status.',
  GEOCODE_NO_RESULT: 'No address match.',
  ADDRESS_NOT_PRECISE: 'Confirm the pin location.',
  DISABLED: 'Turn automated measurements on under Measurements > Integration & usage.',
};
