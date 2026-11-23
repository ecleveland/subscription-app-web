import type { ReactNode } from 'react';
import type { ReportState } from '@/lib/use-report';

export const cardClass = 'bg-surface border border-line rounded-md p-4';
export const linkButtonClass = 'mt-3 inline-block btn-primary';

export function ReportSection({
  id,
  title,
  controls,
  children,
}: {
  id: string;
  title: string;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 id={id} className="section-title">
          {title}
        </h2>
        {controls}
      </div>
      {children}
    </section>
  );
}

// Loading, error and empty handling shared by the report sections on the
// Reports and Business pages.
export function ReportBody<T>({
  state,
  loadingText,
  isEmpty,
  empty,
  children,
}: {
  state: ReportState<T>;
  loadingText: string;
  isEmpty: (data: T) => boolean;
  empty: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.error) {
    return <p className="text-sm text-danger">{state.error}</p>;
  }
  if (state.loading || state.data === null) {
    return <p className="text-muted">{loadingText}</p>;
  }
  if (isEmpty(state.data)) {
    return <div className={`${cardClass} text-center py-8`}>{empty}</div>;
  }
  return <div className={cardClass}>{children(state.data)}</div>;
}
