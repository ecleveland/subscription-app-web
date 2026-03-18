'use client';

import { useState, KeyboardEvent } from 'react';

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export default function TagInput({ tags, onChange }: Props) {
  const [input, setInput] = useState('');

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput('');
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus-within:ring-2 focus-within:ring-blue-500">
      {tags.map((tag, i) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(i)}
            className="hover:text-blue-900 dark:hover:text-blue-100"
            aria-label={`Remove ${tag}`}
          >
            x
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={tags.length === 0 ? 'Add tags...' : ''}
        className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
        aria-label="Add tag"
      />
    </div>
  );
}
