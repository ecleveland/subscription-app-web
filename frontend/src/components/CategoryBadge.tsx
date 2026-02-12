const CATEGORY_COLORS: Record<string, string> = {
  Streaming: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  Software: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Gaming: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'Cloud Storage': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  'News & Media': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  'Health & Fitness': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  Education: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  Utilities: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300',
  Other: 'bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300',
};

export default function CategoryBadge({ category }: { category: string }) {
  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}
    >
      {category}
    </span>
  );
}
