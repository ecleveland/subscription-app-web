vi.mock('../api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api';
import {
  LABEL_COLORS,
  defaultLabelColor,
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  withLabel,
  isReservedLabelName,
  RESERVED_LABEL_NAME,
  labelTextColor,
} from '../labels';
import type { Label } from '../types';

describe('labels api wrappers', () => {
  afterEach(() => vi.clearAllMocks());

  it('listLabels calls GET /labels and toggles includeArchived', async () => {
    await listLabels();
    expect(apiFetch).toHaveBeenCalledWith('/labels');
    await listLabels(true);
    expect(apiFetch).toHaveBeenCalledWith('/labels?includeArchived=true');
  });

  it('createLabel POSTs the body', async () => {
    await createLabel({ name: 'Etsy shop', color: '#2f8a93' });
    expect(apiFetch).toHaveBeenCalledWith('/labels', {
      method: 'POST',
      body: JSON.stringify({ name: 'Etsy shop', color: '#2f8a93' }),
    });
  });

  it('updateLabel PATCHes the body', async () => {
    await updateLabel('l1', { name: 'Renamed', color: '#6b4f9e' });
    expect(apiFetch).toHaveBeenCalledWith('/labels/l1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed', color: '#6b4f9e' }),
    });
    await updateLabel('l1', { isArchived: true });
    expect(apiFetch).toHaveBeenCalledWith('/labels/l1', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });
  });

  it('deleteLabel sends DELETE /labels/:id', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ outcome: 'archived' });
    await expect(deleteLabel('l1')).resolves.toEqual({ outcome: 'archived' });
    expect(apiFetch).toHaveBeenCalledWith('/labels/l1', { method: 'DELETE' });
  });
});

describe('defaultLabelColor', () => {
  it('picks colors in order and wraps around after the last one', () => {
    expect(defaultLabelColor(0)).toBe(LABEL_COLORS[0]);
    expect(defaultLabelColor(1)).toBe(LABEL_COLORS[1]);
    expect(defaultLabelColor(LABEL_COLORS.length)).toBe(LABEL_COLORS[0]);
    expect(defaultLabelColor(LABEL_COLORS.length + 2)).toBe(LABEL_COLORS[2]);
  });

  it('only offers lowercase six digit hex colors the API accepts', () => {
    expect(LABEL_COLORS).toHaveLength(8);
    for (const color of LABEL_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('withLabel', () => {
  function make(id: string, name: string): Label {
    return {
      _id: id,
      householdId: 'h',
      name,
      color: '#2f8a93',
      isArchived: false,
      createdAt: '',
      updatedAt: '',
    };
  }

  it('inserts the label in name order, ignoring case', () => {
    const list = [make('l1', 'apple'), make('l2', 'Cherry')];
    const result = withLabel(list, make('l3', 'Banana'));
    expect(result.map((l) => l.name)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  it('returns a new array and leaves the input untouched', () => {
    const list = [make('l1', 'Zoo')];
    const result = withLabel(list, make('l2', 'Art'));
    expect(result).not.toBe(list);
    expect(list.map((l) => l.name)).toEqual(['Zoo']);
  });

  it('adds to an empty list', () => {
    expect(withLabel([], make('l1', 'Solo')).map((l) => l._id)).toEqual(['l1']);
  });
});

describe('isReservedLabelName', () => {
  it('matches Personal ignoring case and surrounding space', () => {
    expect(RESERVED_LABEL_NAME).toBe('Personal');
    expect(isReservedLabelName('Personal')).toBe(true);
    expect(isReservedLabelName('  personal ')).toBe(true);
    expect(isReservedLabelName('PERSONAL')).toBe(true);
  });

  it('allows other names, including ones that contain Personal', () => {
    expect(isReservedLabelName('Personal care')).toBe(false);
    expect(isReservedLabelName('Etsy shop')).toBe(false);
    expect(isReservedLabelName('')).toBe(false);
  });
});

describe('labelTextColor', () => {
  it('uses dark text on light colors and light text on dark ones', () => {
    expect(labelTextColor('#ffffff')).toBe('#111111');
    expect(labelTextColor('#f5d76e')).toBe('#111111');
    expect(labelTextColor('#000000')).toBe('#ffffff');
    expect(labelTextColor('#2f8a93')).toBe('#ffffff');
  });

  it('accepts short hex and falls back to light text on bad input', () => {
    expect(labelTextColor('#fff')).toBe('#111111');
    expect(labelTextColor('nope')).toBe('#ffffff');
  });
});
