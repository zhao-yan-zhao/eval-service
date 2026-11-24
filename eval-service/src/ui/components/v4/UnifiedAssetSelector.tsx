import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface UnifiedAssetOption {
  id: string;
  label: string;
  subLabel?: string;
  group?: string;
  badge?: string;
  badgeTone?: 'cyan' | 'emerald' | 'indigo' | 'amber' | 'slate';
}

export interface UnifiedAssetSelectorProps {
  value: string;
  options: UnifiedAssetOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  accent?: 'cyan' | 'emerald' | 'indigo';
  emptyText?: string;
  onChange: (id: string) => void;
  className?: string;
  triggerLabelPrefix?: string;
}

const ACCENT_STYLES: Record<
  'cyan' | 'emerald' | 'indigo',
  {
    triggerOpen: string;
    triggerHover: string;
    activeRow: string;
    checkIcon: string;
    focusBorder: string;
  }
> = {
  cyan: {
    triggerOpen: 'border-cyan-500/70 bg-cyan-500/10 text-cyan-100',
    triggerHover: 'hover:border-cyan-500/50',
    activeRow: 'bg-cyan-500/15 text-cyan-100',
    checkIcon: 'text-cyan-400',
    focusBorder: 'focus:border-cyan-500',
  },
  emerald: {
    triggerOpen: 'border-emerald-500/70 bg-emerald-500/10 text-emerald-100',
    triggerHover: 'hover:border-emerald-500/50',
    activeRow: 'bg-emerald-500/15 text-emerald-100',
    checkIcon: 'text-emerald-400',
    focusBorder: 'focus:border-emerald-500',
  },
  indigo: {
    triggerOpen: 'border-indigo-500/70 bg-indigo-500/10 text-indigo-100',
    triggerHover: 'hover:border-indigo-500/50',
    activeRow: 'bg-indigo-500/15 text-indigo-100',
    checkIcon: 'text-indigo-400',
    focusBorder: 'focus:border-indigo-500',
  },
};

const BADGE_STYLES: Record<'cyan' | 'emerald' | 'indigo' | 'amber' | 'slate', string> = {
  cyan: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
  emerald: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  indigo: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300',
  amber: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  slate: 'border-slate-700 bg-slate-800/80 text-slate-300',
};

/**
 * 三库共用的紧凑型可搜索分组下拉选择器
 */
export function UnifiedAssetSelector({
  value,
  options,
  placeholder = '快速选择并跳转...',
  searchPlaceholder = '搜索名称、ID 或分类...',
  accent = 'cyan',
  emptyText = '未找到匹配项',
  onChange,
  className = '',
  triggerLabelPrefix,
}: UnifiedAssetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const styles = ACCENT_STYLES[accent];

  const selectedOption = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);

    const handleMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? options.filter(
          (opt) =>
            opt.label.toLowerCase().includes(q) ||
            opt.id.toLowerCase().includes(q) ||
            (opt.subLabel?.toLowerCase().includes(q) ?? false) ||
            (opt.group?.toLowerCase().includes(q) ?? false) ||
            (opt.badge?.toLowerCase().includes(q) ?? false),
        )
      : options;

    const groupMap = new Map<string, UnifiedAssetOption[]>();
    for (const opt of matched) {
      const gName = opt.group || '全部';
      const list = groupMap.get(gName) ?? [];
      list.push(opt);
      groupMap.set(gName, list);
    }

    return {
      totalMatched: matched.length,
      firstOption: matched[0] ?? null,
      groups: Array.from(groupMap.entries()),
    };
  }, [options, query]);

  const handleSelect = (id: string) => {
    setOpen(false);
    onChange(id);
  };

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title={selectedOption ? `${selectedOption.label} (${selectedOption.id})` : placeholder}
        className={`inline-flex h-8 w-full min-w-[200px] max-w-[320px] items-center justify-between gap-2 rounded-md border px-2.5 text-xs transition cursor-pointer ${
          open
            ? styles.triggerOpen
            : `border-[#30363d] bg-[#0d1117] text-slate-100 ${styles.triggerHover}`
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {triggerLabelPrefix && (
            <span className="shrink-0 text-[10px] text-slate-400">{triggerLabelPrefix}</span>
          )}
          <span className={`truncate font-medium ${selectedOption ? 'text-slate-100' : 'text-slate-400'}`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && (
            <span
              className={`shrink-0 rounded border px-1 py-0.2 font-mono text-[9px] leading-tight ${
                BADGE_STYLES[selectedOption.badgeTone ?? 'slate']
              }`}
            >
              {selectedOption.badge}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[330px] sm:w-[370px] overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117] shadow-2xl shadow-black/70">
          <div className="border-b border-[#30363d] bg-[#161b22] p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredGroups.firstOption) {
                    e.preventDefault();
                    handleSelect(filteredGroups.firstOption.id);
                  }
                }}
                placeholder={searchPlaceholder}
                className={`w-full rounded-md border border-[#30363d] bg-[#0d1117] py-1.5 pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none ${styles.focusBorder}`}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[min(340px,50vh)] overflow-y-auto p-1.5">
            {filteredGroups.totalMatched === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">{emptyText}</div>
            ) : (
              filteredGroups.groups.map(([groupName, items]) => (
                <div key={groupName} className="mb-1.5 last:mb-0">
                  {filteredGroups.groups.length > 1 || groupName !== '全部' ? (
                    <div className="sticky top-0 z-10 bg-[#0d1117]/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 backdrop-blur-sm">
                      {groupName} ({items.length})
                    </div>
                  ) : null}
                  <div className="space-y-0.5">
                    {items.map((opt) => {
                      const isSelected = opt.id === value;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleSelect(opt.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition cursor-pointer ${
                            isSelected
                              ? styles.activeRow
                              : 'text-slate-200 hover:bg-[#161b22]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium">{opt.label}</span>
                              {opt.badge && (
                                <span
                                  className={`shrink-0 rounded border px-1 py-0.2 font-mono text-[9px] leading-tight ${
                                    BADGE_STYLES[opt.badgeTone ?? 'slate']
                                  }`}
                                >
                                  {opt.badge}
                                </span>
                              )}
                            </div>
                            {opt.subLabel && (
                              <div className="truncate font-mono text-[10px] text-slate-500">
                                {opt.subLabel}
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <Check className={`h-3.5 w-3.5 shrink-0 ${styles.checkIcon}`} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
