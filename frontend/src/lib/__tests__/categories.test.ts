vi.mock('../api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api';
import {
  listCategories,
  createCategory,
  updateCategory,
  reorderCategories,
  listCategoryGroups,
  createCategoryGroup,
  updateCategoryGroup,
} from '../categories';

describe('categories api wrappers', () => {
  afterEach(() => vi.clearAllMocks());

  it('listCategories calls GET /categories and toggles includeArchived', async () => {
    await listCategories();
    expect(apiFetch).toHaveBeenCalledWith('/categories');
    await listCategories(true);
    expect(apiFetch).toHaveBeenCalledWith('/categories?includeArchived=true');
  });

  it('createCategory POSTs the body', async () => {
    await createCategory({ name: 'Coffee', groupId: 'g1', isIncome: false });
    expect(apiFetch).toHaveBeenCalledWith('/categories', {
      method: 'POST',
      body: JSON.stringify({ name: 'Coffee', groupId: 'g1', isIncome: false }),
    });
  });

  it('updateCategory PATCHes the body', async () => {
    await updateCategory('c1', { name: 'Renamed' });
    expect(apiFetch).toHaveBeenCalledWith('/categories/c1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' }),
    });
    await updateCategory('c1', { isArchived: true });
    expect(apiFetch).toHaveBeenCalledWith('/categories/c1', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });
  });

  it('reorderCategories POSTs the id list', async () => {
    await reorderCategories(['c2', 'c1']);
    expect(apiFetch).toHaveBeenCalledWith('/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ categoryIds: ['c2', 'c1'] }),
    });
  });

  it('listCategoryGroups calls GET /categories/groups', async () => {
    await listCategoryGroups();
    expect(apiFetch).toHaveBeenCalledWith('/categories/groups');
  });

  it('createCategoryGroup POSTs the body', async () => {
    await createCategoryGroup({ name: 'Pets' });
    expect(apiFetch).toHaveBeenCalledWith('/categories/groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Pets' }),
    });
  });

  it('updateCategoryGroup PATCHes the body', async () => {
    await updateCategoryGroup('g1', { name: 'Home', sortOrder: 2 });
    expect(apiFetch).toHaveBeenCalledWith('/categories/groups/g1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Home', sortOrder: 2 }),
    });
  });
});
