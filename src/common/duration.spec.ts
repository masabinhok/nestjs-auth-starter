import { parseDuration } from './duration.js';

describe('parseDuration', () => {
  it.each([
    ['250ms', 250],
    ['30s', 30_000],
    ['15m', 900_000],
    ['1h', 3_600_000],
    ['30d', 2_592_000_000],
    ['1w', 604_800_000],
  ])('%s', (input, ms) => expect(parseDuration(input)).toBe(ms));

  it('rejects other formats', () => {
    expect(() => parseDuration('15 minutes')).toThrow();
  });
});
