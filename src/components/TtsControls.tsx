import { createMemo, Show, For, type Component } from 'solid-js';
import {
  Volume2,
  Volume1,
  VolumeX,
  Play,
  Square,
  RotateCcw,
  Sparkles,
} from 'lucide-solid';
import { ttsStore, SPEED_PRESETS } from '../stores/ttsStore';
import { VoiceCombobox } from './VoiceCombobox';
import {
  TTS_MARGIN_MAX,
  TTS_MARGIN_MIN,
  TTS_MARGIN_STEP,
  readTtsMarginInput,
} from '../stores/readingSessionStore';

interface Props {
  compact?: boolean;
  headerMargin?: number;
  footerMargin?: number;
  onHeaderMarginChange?: (value: number) => void;
  onFooterMarginChange?: (value: number) => void;
  onResetMargins?: () => void;
}

export const TtsControls: Component<Props> = (props) => {
  const currentSpeedLabel = createMemo(() => {
    const s = ttsStore.speed();
    const pct = Math.round((s - 1.0) * 100);
    if (pct === 0) return `${s.toFixed(2).replace(/\.?0+$/, '')}x (Normal)`;
    return `${s.toFixed(2).replace(/\.?0+$/, '')}x (${pct > 0 ? '+' : ''}${pct}%)`;
  });

  const isCurrentVoicePreviewing = createMemo(() => {
    return ttsStore.previewingVoice() === ttsStore.voice();
  });

  const handleTogglePreview = () => {
    if (isCurrentVoicePreviewing()) {
      ttsStore.stopPreview();
    } else {
      void ttsStore.previewVoice(ttsStore.voice());
    }
  };

  const handleVolumeToggleMute = () => {
    if (ttsStore.volume() > 0) {
      ttsStore.setVolume(0);
    } else {
      ttsStore.setVolume(1.0);
    }
  };

  const volumePercentage = createMemo(() => {
    return Math.round(ttsStore.volume() * 100);
  });

  return (
    <div class={props.compact ? 'tts-controls tts-controls--compact' : 'tts-controls'}>
      {/* Voice Selection Section */}
      <div class="tts-section">
        <div class="tts-section__header">
          <span class="tts-section__title">
            <Sparkles size={14} class="tts-icon-accent" />
            Voice Selection
          </span>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
            <Show when={ttsStore.isLoadingVoices()}>
              <span class="tts-badge-loading">Loading...</span>
            </Show>
            <button
              type="button"
              class={`tts-preview-btn ${isCurrentVoicePreviewing() ? 'tts-preview-btn--active' : ''}`}
              onClick={handleTogglePreview}
              title={isCurrentVoicePreviewing() ? 'Stop preview' : 'Preview current voice'}
              aria-label={isCurrentVoicePreviewing() ? 'Stop preview' : 'Preview voice'}
            >
              <Show
                when={isCurrentVoicePreviewing()}
                fallback={<><Play size={13} fill="currentColor" /> <span>Test</span></>}
              >
                <><Square size={12} fill="currentColor" /> <span>Stop</span></>
              </Show>
            </button>
          </div>
        </div>

        {/* Voice Combobox with fuzzy search */}
        <VoiceCombobox
          value={ttsStore.voice()}
          onChange={(shortName) => ttsStore.setVoice(shortName)}
          compact={props.compact}
        />
      </div>

      {/* Speed / Rate Section */}
      <div class="tts-section">
        <div class="tts-section__header">
          <span class="tts-section__title">Speech Speed</span>
          <span class="tts-section__value">{currentSpeedLabel()}</span>
        </div>

        <div class="tts-slider-wrapper">
          <input
            type="range"
            class="tts-slider"
            min="0.5"
            max="2.0"
            step="0.05"
            value={ttsStore.speed()}
            onInput={(e) => ttsStore.setSpeed(parseFloat(e.currentTarget.value))}
            aria-label="Speech speed"
          />
        </div>

        {/* Speed preset chips */}
        <div class="tts-presets-row">
          <For each={SPEED_PRESETS}>
            {(preset) => (
              <button
                type="button"
                class={`tts-preset-chip ${Math.abs(ttsStore.speed() - preset) < 0.01 ? 'tts-preset-chip--active' : ''}`}
                onClick={() => ttsStore.setSpeed(preset)}
              >
                {preset}x
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Volume Section */}
      <div class="tts-section">
        <div class="tts-section__header">
          <span class="tts-section__title">Audio Volume</span>
          <span class="tts-section__value">{volumePercentage()}%</span>
        </div>

        <div class="tts-volume-row">
          <button
            type="button"
            class="tts-icon-btn"
            onClick={handleVolumeToggleMute}
            title={ttsStore.volume() > 0 ? 'Mute' : 'Unmute'}
            aria-label={ttsStore.volume() > 0 ? 'Mute audio' : 'Unmute audio'}
          >
            <Show
              when={ttsStore.volume() > 0.5}
              fallback={
                <Show when={ttsStore.volume() > 0} fallback={<VolumeX size={18} />}>
                  <Volume1 size={18} />
                </Show>
              }
            >
              <Volume2 size={18} />
            </Show>
          </button>

          <input
            type="range"
            class="tts-slider tts-slider--volume"
            min="0"
            max="1"
            step="0.01"
            value={ttsStore.volume()}
            onInput={(e) => ttsStore.setVolume(parseFloat(e.currentTarget.value))}
            aria-label="Volume level"
          />
        </div>
      </div>

      {/* Exclude Margins Section (if handlers provided) */}
      <Show when={props.headerMargin !== undefined && props.footerMargin !== undefined}>
        <div class="tts-section tts-section--margins">
          <div class="tts-section__header">
            <span class="tts-section__title">Exclude Margins</span>
            <Show when={props.onResetMargins}>
              <button
                type="button"
                class="tts-reset-btn"
                onClick={props.onResetMargins}
                title="Reset to default margins"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
            </Show>
          </div>
          <div class="tts-hint">
            Ignore headers and footers when extracting spoken sentences.
          </div>

          <div class="tts-margin-fields">
            <label class="tts-margin-field">
              <div class="tts-margin-label-row">
                <span>Top Header</span>
                <span>{props.headerMargin}px</span>
              </div>
              <input
                type="range"
                class="tts-slider"
                min={TTS_MARGIN_MIN}
                max={TTS_MARGIN_MAX}
                step={TTS_MARGIN_STEP}
                value={props.headerMargin}
                onInput={(e) => props.onHeaderMarginChange?.(readTtsMarginInput(e.currentTarget.value))}
                aria-label="Header exclude margin"
              />
            </label>

            <label class="tts-margin-field">
              <div class="tts-margin-label-row">
                <span>Bottom Footer</span>
                <span>{props.footerMargin}px</span>
              </div>
              <input
                type="range"
                class="tts-slider"
                min={TTS_MARGIN_MIN}
                max={TTS_MARGIN_MAX}
                step={TTS_MARGIN_STEP}
                value={props.footerMargin}
                onInput={(e) => props.onFooterMarginChange?.(readTtsMarginInput(e.currentTarget.value))}
                aria-label="Footer exclude margin"
              />
            </label>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default TtsControls;
