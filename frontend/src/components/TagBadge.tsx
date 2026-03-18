export default function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
      {tag}
    </span>
  );
}
