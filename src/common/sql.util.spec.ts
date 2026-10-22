import { returned } from './sql.util';

describe('returned()', () => {
  it('unwraps UPDATE/DELETE ... RETURNING ([rows, count])', () => {
    expect(returned([[{ amount: '420' }], 1])).toEqual([{ amount: '420' }]);
    expect(returned([[], 0])).toEqual([]);
  });
  it('passes SELECT / INSERT rows through', () => {
    expect(returned([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
    expect(returned([])).toEqual([]);
  });
  it('a two-row SELECT is not mistaken for [rows, count]', () => {
    expect(returned([{ id: 1 }, { id: 2 }])).toHaveLength(2);
  });
  it('anything else is no rows', () => {
    expect(returned(undefined)).toEqual([]);
  });
});
