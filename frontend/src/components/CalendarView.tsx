'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { Subscription } from '@/lib/types';
import { getBillingDatesInMonth, getCalendarDays } from '@/lib/calendar';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface BillingEvent {
  subscription: Subscription;
  date: Date;
}

interface Props {
  subscriptions: Subscription[];
}

export default function CalendarView({ subscriptions }: Props) {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());

  const days = useMemo(() => getCalendarDays(currentYear, currentMonth), [currentYear, currentMonth]);

  // Build a map of day -> billing events for the current month
  const billingMap = useMemo(() => {
    const map = new Map<string, BillingEvent[]>();
    for (const sub of subscriptions) {
      if (!sub.isActive) continue;
      const dates = getBillingDatesInMonth(sub, currentYear, currentMonth);
      for (const d of dates) {
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const existing = map.get(key) || [];
        existing.push({ subscription: sub, date: d });
        map.set(key, existing);
      }
    }
    return map;
  }, [subscriptions, currentYear, currentMonth]);

  const goToPrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const isToday = (day: typeof days[0]) =>
    day.isCurrentMonth &&
    day.date === today.getDate() &&
    currentMonth === today.getMonth() &&
    currentYear === today.getFullYear();

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={goToPrevMonth}
          className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          aria-label="Previous month"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {MONTH_NAMES[currentMonth]} {currentYear}
        </h2>
        <button
          onClick={goToNextMonth}
          className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          aria-label="Next month"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {DAY_HEADERS.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {days.map((day, idx) => {
          const key = `${day.year}-${day.month}-${day.date}`;
          const events = day.isCurrentMonth ? (billingMap.get(key) || []) : [];

          return (
            <div
              key={idx}
              className={`min-h-[80px] md:min-h-[100px] p-1.5 bg-white dark:bg-gray-800 ${
                !day.isCurrentMonth ? 'opacity-40' : ''
              }`}
            >
              <div
                className={`text-sm font-medium mb-1 w-7 h-7 flex items-center justify-center rounded-full ${
                  isToday(day)
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {day.date}
              </div>
              <div className="space-y-0.5">
                {events.map((event) => (
                  <Link
                    key={event.subscription._id}
                    href={`/subscriptions/${event.subscription._id}/edit`}
                    className="block text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors truncate"
                  >
                    {event.subscription.name} · ${event.subscription.cost}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
