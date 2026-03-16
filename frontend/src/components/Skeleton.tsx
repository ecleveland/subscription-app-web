interface SkeletonProps {
  variant?: 'rectangle' | 'circle';
  className?: string;
}

export default function Skeleton({ variant = 'rectangle', className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 ${
        variant === 'circle' ? 'rounded-full' : 'rounded'
      } ${className}`}
    />
  );
}
