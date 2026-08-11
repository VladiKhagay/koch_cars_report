import { describe, expect, it } from 'vitest';
import { parseOcrAnswer } from './ocr';

describe('parseOcrAnswer — VIN', () => {
  it('accepts a bare 17-char VIN', () => {
    expect(parseOcrAnswer('1HGCM82633A004352', 'vin')).toEqual({ text: '1HGCM82633A004352', reason: null });
  });

  it('extracts the VIN out of a chatty preamble', () => {
    expect(parseOcrAnswer('The VIN in the photo is 1HGCM82633A004352.', 'vin')).toEqual({
      text: '1HGCM82633A004352',
      reason: null,
    });
  });

  it('lowercase answers are normalized to uppercase', () => {
    expect(parseOcrAnswer('1hgcm82633a004352', 'vin').text).toBe('1HGCM82633A004352');
  });

  it('rejects answers with no plausible 17-char run', () => {
    expect(parseOcrAnswer('I can see a car but no VIN sticker', 'vin')).toEqual({
      text: null,
      reason: 'not_in_frame',
    });
  });
});

describe('parseOcrAnswer — plate', () => {
  it('accepts a plain plate and keeps separators', () => {
    expect(parseOcrAnswer('12-345-67', 'plate')).toEqual({ text: '12-345-67', reason: null });
  });

  it('strips wrapping quotes and trailing period', () => {
    expect(parseOcrAnswer('"A123 BC 77".', 'plate').text).toBe('A123 BC 77');
  });

  it('takes the value after a colon-style preamble', () => {
    expect(parseOcrAnswer('Plate: 12-345-67', 'plate').text).toBe('12-345-67');
  });

  it('rejects implausibly long extractions', () => {
    expect(parseOcrAnswer('THE LICENSE PLATE IS PARTLY VISIBLE BEHIND THE TRAILER', 'plate').text).toBeNull();
  });
});

describe('parseOcrAnswer — unreadable', () => {
  it('maps UNREADABLE <reason> to the enum', () => {
    expect(parseOcrAnswer('UNREADABLE glare', 'plate')).toEqual({ text: null, reason: 'glare' });
    expect(parseOcrAnswer('unreadable: blurry', 'vin')).toEqual({ text: null, reason: 'blurry' });
  });

  it('tolerates prose around the reason word', () => {
    expect(parseOcrAnswer('UNREADABLE - the photo is too dark', 'plate').reason).toBe('dark');
  });

  it('falls back to not_in_frame for unknown reasons and empty answers', () => {
    expect(parseOcrAnswer('UNREADABLE because reasons', 'vin').reason).toBe('not_in_frame');
    expect(parseOcrAnswer('', 'plate')).toEqual({ text: null, reason: 'not_in_frame' });
  });
});
