const CATEGORY_COLORS: Record<string, string> = {
  Streaming: 'bg-purple-100 text-purple-700',
  Software: 'bg-blue-100 text-blue-700',
  Gaming: 'bg-green-100 text-green-700',
  'Cloud Storage': 'bg-cyan-100 text-cyan-700',
  'News & Media': 'bg-orange-100 text-orange-700',
  'Health & Fitness': 'bg-red-100 text-red-700',
  Education: 'bg-yellow-100 text-yellow-700',
  Utilities: 'bg-gray-100 text-gray-700',
  Other: 'bg-slate-100 text-slate-700',
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
