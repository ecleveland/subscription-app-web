export default function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-ink-2">
      {tag}
    </span>
  );
}
