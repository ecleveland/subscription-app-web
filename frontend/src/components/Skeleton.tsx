interface SkeletonProps {
  variant?: 'rectangle' | 'circle';
  className?: string;
}

export default function Skeleton({ variant = 'rectangle', className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-surface-2 ${
        variant === 'circle' ? 'rounded-full' : 'rounded'
      } ${className}`}
    />
  );
}
