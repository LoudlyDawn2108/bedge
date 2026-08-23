import { createSignal, createMemo, createEffect, onCleanup, Show, For, type Component } from 'solid-js';
import {
  Search,
  Check,
  ChevronDown,
  Play,
  Square,
  X,
} from 'lucide-solid';
import { ttsStore } from '../stores/ttsStore';
import type { Voice } from '../services/ttsService';

interface Props {
  value: string;
  onChange: (shortName: string) => void;
  compact?: boolean;
}

function getLanguageDisplayName(langCode: string): string {
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const primary = langCode.split('-')[0];
    const region = langCode.split('-')[1];
    const langName = displayNames.of(primary) || langCode;
    return region ? `${langName} (${region})` : langName;
  } catch {
    return langCode;
  }
}

interface FuzzyResult {
  voice: Voice;
  score: number;
}

function scoreFuzzyMatch(voice: Voice, tokens: string[]): number {
  if (tokens.length === 0) return 1;

  const langDisplayName = getLanguageDisplayName(voice.lang).toLowerCase();
  const searchCorpus = [
    voice.name.toLowerCase(),
    voice.shortName.toLowerCase(),
    voice.lang.toLowerCase(),
    langDisplayName,
    voice.gender.toLowerCase(),
  ].join(' ');

  let totalScore = 0;

  for (const token of tokens) {
    if (!token) continue;

    // Exact word or substring match
    if (searchCorpus.includes(token)) {
      if (voice.name.toLowerCase().startsWith(token)) {
        totalScore += 80;
      } else if (voice.name.toLowerCase().includes(token)) {
        totalScore += 50;
      } else if (voice.lang.toLowerCase().startsWith(token)) {
        totalScore += 40;
      } else if (langDisplayName.includes(token)) {
        totalScore += 35;
      } else {
        totalScore += 20;
      }
      continue;
    }

    // Subsequence fuzzy match against name or language
    let matched = false;
    for (const text of [voice.name.toLowerCase(), langDisplayName, voice.shortName.toLowerCase()]) {
      let tIdx = 0;
      let pIdx = 0;
      let score = 0;
      let prevIdx = -2;

      while (tIdx < text.length && pIdx < token.length) {
        if (text[tIdx] === token[pIdx]) {
          if (tIdx === prevIdx + 1) score += 6;
          else score += 2;
          prevIdx = tIdx;
          pIdx++;
        }
        tIdx++;
      }

      if (pIdx === token.length) {
        totalScore += score;
        matched = true;
        break;
      }
    }

    if (!matched) {
      return 0; // Token did not match
    }
  }

  return totalScore;
}

export const VoiceCombobox: Component<Props> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedCategory, setSelectedCategory] = createSignal<string>('all');
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);

  let containerRef: HTMLDivElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const currentVoice = createMemo(() => {
    return ttsStore.voices().find(v => v.shortName === props.value) ?? {
      name: props.value,
      shortName: props.value,
      lang: 'en-US',
      gender: 'Male' as const,
    };
  });

  const popularLanguages = createMemo(() => {
    const counts = new Map<string, number>();
    for (const v of ttsStore.voices()) {
      const primary = v.lang.split('-')[0];
      counts.set(primary, (counts.get(primary) ?? 0) + 1);
    }
    return ['en', 'es', 'de', 'fr', 'ja', 'zh', 'vi'].filter(code => counts.has(code));
  });

  const filteredVoices = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    const category = selectedCategory();
    const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
    const allVoices = ttsStore.voices();

    const scored: FuzzyResult[] = [];

    for (const voice of allVoices) {
      if (category !== 'all' && !voice.lang.startsWith(category)) {
        continue;
      }

      const score = scoreFuzzyMatch(voice, tokens);
      if (score > 0) {
        scored.push({ voice, score });
      }
    }

    if (tokens.length > 0) {
      scored.sort((a, b) => b.score - a.score);
    }

    return scored.map(item => item.voice);
  });

  function openCombobox() {
    setIsOpen(true);
    setSearchQuery('');
    setHighlightedIndex(0);
    queueMicrotask(() => {
      searchInputRef?.focus();
    });
  }

  function closeCombobox() {
    setIsOpen(false);
    setSearchQuery('');
  }

  function selectVoice(shortName: string) {
    props.onChange(shortName);
    closeCombobox();
  }

  // Click outside to close combobox dropdown
  createEffect(() => {
    if (!isOpen()) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef && !containerRef.contains(event.target as Node)) {
        closeCombobox();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeCombobox();
        return;
      }

      const voices = filteredVoices();
      if (voices.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex(prev => (prev + 1) % voices.length);
        scrollHighlightedIntoView();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex(prev => (prev - 1 + voices.length) % voices.length);
        scrollHighlightedIntoView();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const highlighted = voices[highlightedIndex()];
        if (highlighted) {
          selectVoice(highlighted.shortName);
        }
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    onCleanup(() => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  function scrollHighlightedIntoView() {
    queueMicrotask(() => {
      if (!listRef) return;
      const highlightedEl = listRef.querySelector(`[data-index="${highlightedIndex()}"]`);
      highlightedEl?.scrollIntoView({ block: 'nearest' });
    });
  }

  return (
    <div class="voice-combobox" ref={containerRef}>
      {/* Trigger button */}
      <button
        type="button"
        class={`voice-combobox__trigger ${isOpen() ? 'voice-combobox__trigger--open' : ''}`}
        onClick={() => (isOpen() ? closeCombobox() : openCombobox())}
        aria-haspopup="listbox"
        aria-expanded={isOpen()}
      >
        <div class="voice-combobox__trigger-content">
          <span class="voice-combobox__name">{currentVoice().name}</span>
          <span class="voice-combobox__meta-tags">
            <span class={`voice-badge voice-badge--${currentVoice().gender.toLowerCase()}`}>
              {currentVoice().gender}
            </span>
            <span class="voice-badge voice-badge--locale">
              {currentVoice().lang}
            </span>
          </span>
        </div>
        <ChevronDown size={16} class={`voice-combobox__chevron ${isOpen() ? 'voice-combobox__chevron--open' : ''}`} />
      </button>

      {/* Floating Dropdown */}
      <Show when={isOpen()}>
        <div class="voice-combobox__dropdown">
          {/* Search box */}
          <div class="voice-combobox__search-wrapper">
            <Search size={14} class="voice-combobox__search-icon" />
            <input
              ref={searchInputRef}
              type="text"
              class="voice-combobox__search-input"
              placeholder="Search voice, language, gender..."
              value={searchQuery()}
              onInput={(e) => {
                setSearchQuery(e.currentTarget.value);
                setHighlightedIndex(0);
              }}
            />
            <Show when={searchQuery()}>
              <button
                type="button"
                class="voice-combobox__clear-btn"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef?.focus();
                }}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            </Show>
          </div>

          {/* Quick language filter tabs */}
          <div class="voice-combobox__category-chips">
            <button
              type="button"
              class={`voice-chip ${selectedCategory() === 'all' ? 'voice-chip--active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              All
            </button>
            <For each={popularLanguages()}>
              {(langCode) => (
                <button
                  type="button"
                  class={`voice-chip ${selectedCategory() === langCode ? 'voice-chip--active' : ''}`}
                  onClick={() => setSelectedCategory(langCode)}
                >
                  {getLanguageDisplayName(langCode)}
                </button>
              )}
            </For>
          </div>

          {/* Voices list */}
          <div class="voice-combobox__list" ref={listRef} role="listbox">
            <Show
              when={filteredVoices().length > 0}
              fallback={
                <div class="voice-combobox__empty">
                  No matching voices found for "{searchQuery()}".
                </div>
              }
            >
              <For each={filteredVoices()}>
                {(v, index) => {
                  const isSelected = () => v.shortName === props.value;
                  const isHighlighted = () => index() === highlightedIndex();
                  const isPreviewing = () => ttsStore.previewingVoice() === v.shortName;

                  return (
                    <div
                      class={`voice-combobox__item ${isSelected() ? 'voice-combobox__item--selected' : ''} ${isHighlighted() ? 'voice-combobox__item--highlighted' : ''}`}
                      data-index={index()}
                      role="option"
                      aria-selected={isSelected()}
                      onClick={() => selectVoice(v.shortName)}
                      onMouseEnter={() => setHighlightedIndex(index())}
                    >
                      <div class="voice-combobox__item-main">
                        <div class="voice-combobox__item-title">
                          <span>{v.name}</span>
                          <Show when={isSelected()}>
                            <Check size={14} class="voice-combobox__check-icon" />
                          </Show>
                        </div>
                        <div class="voice-combobox__item-sub">
                          <span class={`voice-badge voice-badge--${v.gender.toLowerCase()}`}>
                            {v.gender}
                          </span>
                          <span class="voice-badge voice-badge--locale">
                            {getLanguageDisplayName(v.lang)} ({v.lang})
                          </span>
                        </div>
                      </div>

                      {/* Item Preview Button */}
                      <button
                        type="button"
                        class={`voice-item-preview-btn ${isPreviewing() ? 'voice-item-preview-btn--active' : ''}`}
                        title={isPreviewing() ? 'Stop preview' : `Test ${v.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPreviewing()) {
                            ttsStore.stopPreview();
                          } else {
                            void ttsStore.previewVoice(v.shortName);
                          }
                        }}
                      >
                        <Show
                          when={isPreviewing()}
                          fallback={<Play size={12} fill="currentColor" />}
                        >
                          <Square size={11} fill="currentColor" />
                        </Show>
                      </button>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>

          <div class="voice-combobox__footer">
            <span>{filteredVoices().length} of {ttsStore.voices().length} voices</span>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default VoiceCombobox;
