// A hue per category, shown as a dot beside the name so the badge itself
// stays on the page's ink and paper rather than a pastel block.
const CATEGORY_DOTS: Record<string, string> = {
  Streaming: 'bg-[#6b4f9e]',
  Software: 'bg-info',
  Gaming: 'bg-accent',
  'Cloud Storage': 'bg-[#2f8a93]',
  'News & Media': 'bg-warn',
  'Health & Fitness': 'bg-danger',
  Education: 'bg-[#c29a2a]',
  Utilities: 'bg-ink-2',
  Other: 'bg-muted',
};

export default function CategoryBadge({ category }: { category: string }) {
  const dot = CATEGORY_DOTS[category] || CATEGORY_DOTS.Other;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-2">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {category}
    </span>
  );
}
