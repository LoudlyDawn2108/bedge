import type { Component } from 'solid-js';
import {
  TTS_MARGIN_MAX,
  TTS_MARGIN_MIN,
  TTS_MARGIN_STEP,
  readTtsMarginInput,
} from '../stores/readingSessionStore';

interface Props {
  headerMargin: number;
  footerMargin: number;
  onHeaderMarginChange: (value: number) => void;
  onFooterMarginChange: (value: number) => void;
  onReset: () => void;
  compact?: boolean;
}

export const TtsMarginControls: Component<Props> = (props) => {
  return (
    <div class={props.compact ? 'tts-margin-controls tts-margin-controls--compact' : 'tts-margin-controls'}>
      <div class="tts-margin-controls__title">TTS exclude margins</div>
      <div class="tts-margin-controls__hint">
        Ignore repeated header and footer text when building spoken sentences.
      </div>

      <label class="tts-margin-controls__field">
        <span class="tts-margin-controls__label-row">
          <span>Header</span>
          <span>{props.headerMargin}px</span>
        </span>
        <input
          type="range"
          min={TTS_MARGIN_MIN}
          max={TTS_MARGIN_MAX}
          step={TTS_MARGIN_STEP}
          value={props.headerMargin}
          onInput={(event) => props.onHeaderMarginChange(readTtsMarginInput(event.currentTarget.value))}
        />
      </label>

      <label class="tts-margin-controls__field">
        <span class="tts-margin-controls__label-row">
          <span>Footer</span>
          <span>{props.footerMargin}px</span>
        </span>
        <input
          type="range"
          min={TTS_MARGIN_MIN}
          max={TTS_MARGIN_MAX}
          step={TTS_MARGIN_STEP}
          value={props.footerMargin}
          onInput={(event) => props.onFooterMarginChange(readTtsMarginInput(event.currentTarget.value))}
        />
      </label>

      <button class="tts-margin-controls__reset" onClick={props.onReset}>Reset margins</button>
    </div>
  );
};

export default TtsMarginControls;
