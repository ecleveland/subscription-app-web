'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  listCategories,
  listCategoryGroups,
  createCategoryGroup,
  updateCategoryGroup,
  updateCategory,
  reorderCategories,
} from '@/lib/categories';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import CategoryForm from '@/components/CategoryForm';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { BudgetCategory, CategoryGroup } from '@/lib/types';

const bySortOrder = <T extends { sortOrder: number; name: string }>(
  a: T,
  b: T,
) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

export default function CategoriesPage() {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which group's "+ Add category" form is open, and which category is being
  // edited — mutually exclusive with each other.
  const [creatingInGroup, setCreatingInGroup] = useState<string | null>(null);
  const [editing, setEditing] = useState<BudgetCategory | null>(null);
  const [archiving, setArchiving] = useState<BudgetCategory | null>(null);

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');

  const [showArchived, setShowArchived] = useState(false);
  // Serializes reorder requests: concurrent moves would both compute their
  // swap from the same stale order and race each other's responses.
  const [reordering, setReordering] = useState(false);

  const refresh = useCallback(async () => {
    const [gs, cs] = await Promise.all([
      listCategoryGroups(),
      listCategories(true),
    ]);
    setGroups(gs);
    setCategories(cs);
    // Fresh data on screen: drop any load-error banner from an earlier fetch.
    setError(null);
  }, []);

  const load = useCallback(async () => {
    try {
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load categories',
      );
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedGroups = useMemo(
    () => [...groups].sort(bySortOrder),
    [groups],
  );
  const activeByGroup = useMemo(() => {
    const map = new Map<string, BudgetCategory[]>();
    for (const c of categories) {
      if (c.isArchived) continue;
      const list = map.get(c.groupId) ?? [];
      list.push(c);
      map.set(c.groupId, list);
    }
    for (const list of map.values()) list.sort(bySortOrder);
    return map;
  }, [categories]);
  const archived = useMemo(
    () => categories.filter((c) => c.isArchived).sort(bySortOrder),
    [categories],
  );
  const groupNameById = useMemo(
    () => new Map(groups.map((g) => [g._id, g.name])),
    [groups],
  );

  async function refreshOrWarn() {
    try {
      await refresh();
    } catch (err) {
      console.error('Category refresh after save failed', err);
      showErrorToast('Saved, but the category list may be out of date.');
    }
  }

  async function handleSaved() {
    setCreatingInGroup(null);
    setEditing(null);
    await refreshOrWarn();
  }

  async function handleCreateGroup(e: FormEvent) {
    e.preventDefault();
    try {
      await createCategoryGroup({ name: newGroupName.trim() });
      showSuccessToast('Group created');
      setNewGroupName('');
      setCreatingGroup(false);
      await refreshOrWarn();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to create group');
    }
  }

  async function handleRenameGroup(e: FormEvent) {
    e.preventDefault();
    if (!editingGroupId) return;
    try {
      await updateCategoryGroup(editingGroupId, { name: groupName.trim() });
      showSuccessToast('Group renamed');
      setEditingGroupId(null);
      await refreshOrWarn();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to rename group');
    }
  }

  async function handleArchive() {
    if (!archiving) return;
    try {
      await updateCategory(archiving._id, { isArchived: true });
      showSuccessToast('Category archived');
      setArchiving(null);
      await refreshOrWarn();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to archive');
    }
  }

  async function handleUnarchive(category: BudgetCategory) {
    try {
      await updateCategory(category._id, { isArchived: false });
      showSuccessToast('Category restored');
      await refreshOrWarn();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to restore');
    }
  }

  // Failure path for reorders: the error toast has already fired; pull the
  // server's actual order back — a group move's per-group PATCHes can
  // partially succeed, leaving the server ahead of the UI's pre-move order.
  async function resyncAfterError() {
    try {
      await refresh();
    } catch (err) {
      // Only logged: the reorder toast already flagged the failure.
      console.error('Resync after failed reorder also failed', err);
    }
  }

  async function handleMoveCategory(
    category: BudgetCategory,
    direction: 'up' | 'down',
  ) {
    if (reordering) return;
    const list = activeByGroup.get(category.groupId) ?? [];
    const from = list.findIndex((c) => c._id === category._id);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= list.length) return;
    const ids = list.map((c) => c._id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setReordering(true);
    try {
      // The endpoint returns the refreshed full list (archived included), so
      // it doubles as the refetch.
      setCategories(await reorderCategories(ids));
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to reorder');
      await resyncAfterError();
    } finally {
      setReordering(false);
    }
  }

  async function handleMoveGroup(
    group: CategoryGroup,
    direction: 'up' | 'down',
  ) {
    if (reordering) return;
    const from = sortedGroups.findIndex((g) => g._id === group._id);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= sortedGroups.length) return;
    // Reindex every group by display order with the pair swapped. Writing
    // indexes each time (rather than swapping the two values) self-heals
    // duplicate sortOrders, including ones left by a partially failed move.
    const order = [...sortedGroups];
    [order[from], order[to]] = [order[to], order[from]];
    setReordering(true);
    try {
      // allSettled, not all: a rejection must not leave sibling PATCHes in
      // flight, or the resync below could read (and render) an order a
      // straggler write then overwrites.
      const results = await Promise.allSettled(
        order.map((g, i) => updateCategoryGroup(g._id, { sortOrder: i })),
      );
      const failed = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      if (failed) throw failed.reason;
      await refresh();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to reorder');
      await resyncAfterError();
    } finally {
      setReordering(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-gray-500">Loading categories…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Categories</h1>
        {!creatingGroup && (
          <button
            onClick={() => setCreatingGroup(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Add group
          </button>
        )}
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {creatingGroup && (
        <form onSubmit={handleCreateGroup} className="flex gap-3 mb-6">
          <input
            aria-label="New group name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            required
            placeholder="Group name"
            className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingGroup(false);
              setNewGroupName('');
            }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
          >
            Cancel
          </button>
        </form>
      )}

      {sortedGroups.length === 0 && !error && (
        <p className="text-gray-500 text-center py-8">
          No category groups yet. Add one to start organizing your budget.
        </p>
      )}

      <div className="space-y-8">
        {sortedGroups.map((group, groupIndex) => {
          const active = activeByGroup.get(group._id) ?? [];
          return (
            <section key={group._id} aria-label={group.name}>
              <div className="flex items-center justify-between mb-2">
                {editingGroupId === group._id ? (
                  <form onSubmit={handleRenameGroup} className="flex gap-2 flex-1">
                    <input
                      aria-label="Group name"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      required
                      className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1 bg-white dark:bg-gray-700"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingGroupId(null)}
                      className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold">{group.name}</h2>
                    <div className="flex items-center gap-2">
                      <button
                        aria-label={`Move group ${group.name} up`}
                        disabled={groupIndex === 0 || reordering}
                        onClick={() => handleMoveGroup(group, 'up')}
                        className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Move group ${group.name} down`}
                        disabled={
                          groupIndex === sortedGroups.length - 1 || reordering
                        }
                        onClick={() => handleMoveGroup(group, 'down')}
                        className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => {
                          setEditingGroupId(group._id);
                          setGroupName(group.name);
                        }}
                        className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => {
                          setEditing(null);
                          setCreatingInGroup(group._id);
                        }}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        + Add category
                      </button>
                    </div>
                  </>
                )}
              </div>

              {creatingInGroup === group._id && (
                <div className="mb-4">
                  <CategoryForm
                    key={group._id}
                    groups={sortedGroups}
                    defaultGroupId={group._id}
                    onSaved={handleSaved}
                    onCancel={() => setCreatingInGroup(null)}
                  />
                </div>
              )}

              {editing && editing.groupId === group._id && (
                <div className="mb-4">
                  <CategoryForm
                    // Remount when the target changes: the form's field state
                    // initializes from the category prop only on mount.
                    key={editing._id}
                    category={editing}
                    groups={sortedGroups}
                    onSaved={handleSaved}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              )}

              {active.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No categories yet.</p>
              ) : (
                <ul className="space-y-2">
                  {active.map((category, index) => (
                    <li
                      key={category._id}
                      className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 bg-white dark:bg-gray-800"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{category.name}</span>
                        {category.isIncome && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            Income
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          aria-label={`Move ${category.name} up`}
                          disabled={index === 0 || reordering}
                          onClick={() => handleMoveCategory(category, 'up')}
                          className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`Move ${category.name} down`}
                          disabled={index === active.length - 1 || reordering}
                          onClick={() => handleMoveCategory(category, 'down')}
                          className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => {
                            setCreatingInGroup(null);
                            setEditing(category);
                          }}
                          className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setArchiving(category)}
                          className="text-sm text-red-600 hover:underline"
                        >
                          Archive
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {archived.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="text-sm text-gray-500 hover:underline"
          >
            {`Archived categories (${archived.length})`}
          </button>
          {showArchived && (
            <ul className="space-y-2 mt-3">
              {archived.map((category) => (
                <li
                  key={category._id}
                  className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 bg-gray-50 dark:bg-gray-900 text-gray-500"
                >
                  <div className="flex items-center gap-2">
                    <span>{category.name}</span>
                    <span className="text-xs">
                      · {groupNameById.get(category.groupId) ?? '—'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleUnarchive(category)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Unarchive
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!archiving}
        title="Archive category"
        message={`Archive "${archiving?.name}"? It will be hidden from new transactions but kept for history; you can unarchive it later.`}
        confirmLabel="Archive"
        onConfirm={handleArchive}
        onCancel={() => setArchiving(null)}
        destructive
      />
    </div>
  );
}
