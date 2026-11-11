import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES, validateDraft, validatePhoto } from './validate';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 10, 10, 0, 1));
});

afterEach(() => jest.useRealTimers());

const validFields = {
  policyNumber: 'POL-HOME-0001',
  incidentDescription: 'Hail damage to the roof',
  incidentDate: '2026-11-03',
};

describe('validateDraft', () => {
  test('accepts a complete draft', () => {
    expect(validateDraft(validFields).valid).toBe(true);
  });

  test('rejects a missing policy', () => {
    const result = validateDraft({ ...validFields, policyNumber: null });
    expect(result.valid).toBe(false);
    expect(result.errors.policyNumber).toBeTruthy();
  });

  test('rejects an empty or over-long description', () => {
    expect(validateDraft({ ...validFields, incidentDescription: '  ' }).valid).toBe(false);
    expect(validateDraft({ ...validFields, incidentDescription: 'x'.repeat(2001) }).valid).toBe(false);
  });

  test('rejects a malformed or incomplete stored date', () => {
    expect(validateDraft({ ...validFields, incidentDate: '03/11/2026' }).valid).toBe(false);
    expect(validateDraft({ ...validFields, incidentDate: '2026-1-3' }).valid).toBe(false);
    expect(validateDraft({ ...validFields, incidentDate: '' }).valid).toBe(false);
  });
});

test.each(['2026-02-29', '2026-02-30', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00', '0000-01-01', '1900-02-29'])('rejects impossible calendar date %s', (incidentDate) => {
  expect(validateDraft({ ...validFields, incidentDate }).errors.incidentDate).toBe('Enter a valid date (MM/DD/YYYY)');
});

test.each(['2024-02-29', '2000-02-29', '2026-04-30', '2025-12-31', '0001-01-01'])('accepts real calendar date %s', (incidentDate) => {
  expect(validateDraft({ ...validFields, incidentDate }).valid).toBe(true);
});

describe('validatePhoto', () => {
  test('accepts allowed types under the size limit', () => {
    expect(validatePhoto('image/jpeg', MAX_PHOTO_BYTES)).toBeNull();
    expect(validatePhoto('image/heic', 100)).toBeNull();
    expect(validatePhoto('application/pdf', 100)).toBeNull();
  });

  test('rejects disallowed content types', () => {
    expect(validatePhoto('video/mp4', 100)).toMatch(/JPEG|HEIC|PNG|PDF/);
  });

  test('rejects files over 10 MB', () => {
    expect(validatePhoto('image/jpeg', MAX_PHOTO_BYTES + 1)).toMatch(/10 MB/);
  });

  test('the allowed-type list matches the server contract enum', () => {
    expect(ALLOWED_PHOTO_TYPES).toEqual(['image/jpeg', 'image/heic', 'image/png', 'application/pdf']);
  });
});


test('empty attachments are rejected before entering the durable manifest', () => {
  expect(validatePhoto('image/jpeg', 0)).toMatch(/empty/);
});

describe('incident date cannot be in the future', () => {
  test.each(['2026-11-11', '2026-12-01', '2027-01-01'])('rejects future date %s', (incidentDate) => {
    const result = validateDraft({ ...validFields, incidentDate });
    expect(result.valid).toBe(false);
    expect(result.errors.incidentDate).toBe('Incident date cannot be in the future');
  });

  test.each(['2026-11-10', '2026-11-09'])('accepts today or a past date %s', (incidentDate) => {
    expect(validateDraft({ ...validFields, incidentDate }).valid).toBe(true);
  });

  test('uses the local date near the end of the day', () => {
    jest.setSystemTime(new Date(2026, 11, 31, 23, 59));
    expect(validateDraft({ ...validFields, incidentDate: '2026-12-31' }).valid).toBe(true);
    expect(validateDraft({ ...validFields, incidentDate: '2027-01-01' }).valid).toBe(false);
  });
});
