import { Show, type Component } from 'solid-js';
import { TtsMarginControls } from './TtsMarginControls';

interface Props {
  title: string;
  currentPage: number;
  totalPages: number;
  zoomLevel: number;
  columnMode: number;
  isPlaying: boolean;
  chromeVisible: boolean;
  settingsOpen: boolean;
  headerMargin: number;
  footerMargin: number;
  hasDocument: boolean;
  onOpenFile: () => void;
  onOpenLibrary: () => void;
  onToggleToc: () => void;
  onPrevSentence: () => void;
  onPlayPause: () => void;
  onNextSentence: () => void;
  onActivity: () => void;
  onSettingsOpenChange: (open: boolean) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  canFitText: boolean;
  onFitWidth: () => void;
  onFitText: () => void;
  onToggleColumnMode: () => void;
  onHeaderMarginChange: (value: number) => void;
  onFooterMarginChange: (value: number) => void;
  onResetTtsMargins: () => void;
}

export const MobileReaderChrome: Component<Props> = (props) => {
  const chromeControlsDisabled = () => !props.chromeVisible;

  function openSettings(): void {
    props.onActivity();
    props.onSettingsOpenChange(true);
  }

  function closeSettings(): void {
    props.onSettingsOpenChange(false);
  }

  const pageLabel = () => props.totalPages > 0
    ? `${props.currentPage + 1} / ${props.totalPages}`
    : 'No PDF';

  return (
    <>
      <div class="mobile-reader-topbar" aria-label="Mobile reader navigation" onPointerDown={props.onActivity}>
        <button class="mobile-icon-button" onClick={props.onOpenLibrary} aria-label="Open library" disabled={chromeControlsDisabled()}>Library</button>
        <div class="mobile-reader-topbar__title">
          <span>{props.title}</span>
          <small>{pageLabel()}</small>
        </div>
        <button class="mobile-icon-button" onClick={props.onOpenFile} disabled={chromeControlsDisabled()}>Open</button>
        <button class="mobile-icon-button" onClick={props.onToggleToc} disabled={chromeControlsDisabled() || !props.hasDocument}>TOC</button>
      </div>

      <Show when={props.hasDocument}>
        <div class="mobile-reader-dock" aria-label="Mobile reader playback controls" onPointerDown={props.onActivity}>
          <button class="mobile-dock-button" onClick={props.onPrevSentence} disabled={chromeControlsDisabled()}>Prev</button>
          <button class="mobile-dock-button mobile-dock-button--primary" onClick={props.onPlayPause} disabled={chromeControlsDisabled()}>
            {props.isPlaying ? 'Pause' : 'Play'}
          </button>
          <button class="mobile-dock-button" onClick={props.onNextSentence} disabled={chromeControlsDisabled()}>Next</button>
          <button class="mobile-dock-button" onClick={openSettings} disabled={chromeControlsDisabled()}>Settings</button>
        </div>
      </Show>

      <Show when={props.settingsOpen}>
        <div class="mobile-sheet-backdrop" onClick={closeSettings} onPointerDown={props.onActivity}>
          <section
            class="mobile-settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Reading settings"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="mobile-settings-sheet__handle" aria-hidden="true" />
            <div class="mobile-settings-sheet__header">
              <div>
                <h2>Reading settings</h2>
                <p>Fit the page, speech, and columns for phone reading.</p>
              </div>
              <button onClick={closeSettings}>Close</button>
            </div>

            <div class="mobile-settings-group">
              <div class="mobile-settings-group__label">Zoom</div>
              <div class="mobile-zoom-controls">
                <button onClick={props.onZoomOut}>-</button>
                <span>{Math.round(props.zoomLevel * 100)}%</span>
                <button onClick={props.onZoomIn}>+</button>
                <div class="mobile-fit-controls">
                  <button onClick={props.onFitText} disabled={!props.canFitText}>Fit text</button>
                  <button onClick={props.onFitWidth}>Fit width</button>
                </div>
              </div>
            </div>

            <div class="mobile-settings-group">
              <div class="mobile-settings-group__label">Text order</div>
              <button class="mobile-wide-button" onClick={props.onToggleColumnMode}>
                {props.columnMode === 1 ? 'Single column' : 'Two columns'}
              </button>
            </div>

            <TtsMarginControls
              compact
              headerMargin={props.headerMargin}
              footerMargin={props.footerMargin}
              onHeaderMarginChange={props.onHeaderMarginChange}
              onFooterMarginChange={props.onFooterMarginChange}
              onReset={props.onResetTtsMargins}
            />
          </section>
        </div>
      </Show>
    </>
  );
};

export default MobileReaderChrome;
