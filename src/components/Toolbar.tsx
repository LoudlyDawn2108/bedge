import { createSignal, type Component } from 'solid-js';
import { pdfStore } from '../stores/pdfStore';
import { DEFAULT_FOOTER_MARGIN, DEFAULT_HEADER_MARGIN, readingSession } from '../stores/readingSessionStore';

const TTS_MARGIN_MIN = 0;
const TTS_MARGIN_MAX = 240;
const TTS_MARGIN_STEP = 5;

function clampTtsMargin(value: number): number {
  if (!Number.isFinite(value)) return TTS_MARGIN_MIN;
  return Math.max(TTS_MARGIN_MIN, Math.min(TTS_MARGIN_MAX, value));
}

function readTtsMarginInput(value: string): number {
  return clampTtsMargin(Number(value));
}

interface Props {
  onOpenFile: () => void;
  onOpenLibrary: () => void;
  onPlay: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export const Toolbar: Component<Props> = (props) => {
  const [showMarginControls, setShowMarginControls] = createSignal(false);

  return (
    <div class="toolbar" style={{
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      padding: '8px 16px',
      background: '#2d2d30',
      'border-bottom': '1px solid #3d3d3d'
    }}>
      {/* Left side */}
      <button onClick={props.onOpenLibrary}>📚 Library</button>
      <button onClick={props.onOpenFile}>Open PDF</button>
      <button onClick={pdfStore.toggleSidebar}>☰ TOC</button>
      
      {/* Column mode toggle */}
      <button onClick={() => readingSession.setColumnMode(readingSession.columnMode() === 1 ? 2 : 1)}>
        {readingSession.columnMode() === 1 ? '📄 1-Col' : '📑 2-Col'}
      </button>
      
      {/* Spacer */}
      <div style={{ flex: 1 }} />
      
      {/* Center - Page navigation */}
      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
        <button onClick={pdfStore.zoomOut}>−</button>
        <span style={{ color: '#fff', 'min-width': '50px', 'text-align': 'center' }}>
          {Math.round(pdfStore.zoomLevel() * 100)}%
        </span>
        <button onClick={pdfStore.zoomIn}>+</button>
        
        <span style={{ color: '#fff', margin: '0 16px' }}>
          Page {pdfStore.currentPage() + 1} of {pdfStore.totalPages()}
        </span>
      </div>
      
      {/* Spacer */}
      <div style={{ flex: 1 }} />
      
      {/* Right side - TTS controls */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setShowMarginControls((show) => !show)}>
          TTS margins
        </button>

        {showMarginControls() && (
          <div
            role="dialog"
            aria-label="TTS exclude margins"
            style={{
              position: 'absolute',
              right: '0',
              top: 'calc(100% + 8px)',
              width: '280px',
              padding: '12px',
              background: '#252526',
              border: '1px solid #4a4a4a',
              'border-radius': '6px',
              'box-shadow': '0 10px 24px rgba(0, 0, 0, 0.35)',
              color: '#fff',
              'z-index': 20,
            }}
          >
            <div style={{ 'font-weight': 600, 'margin-bottom': '8px' }}>TTS exclude margins</div>
            <div style={{ color: '#c8c8c8', 'font-size': '12px', 'margin-bottom': '12px' }}>
              Ignore repeated header and footer text when building spoken sentences.
            </div>

            <label style={{ display: 'grid', gap: '6px', 'margin-bottom': '12px' }}>
              <span style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '13px' }}>
                <span>Header</span>
                <span>{readingSession.headerMargin()}px</span>
              </span>
              <input
                type="range"
                min={TTS_MARGIN_MIN}
                max={TTS_MARGIN_MAX}
                step={TTS_MARGIN_STEP}
                value={readingSession.headerMargin()}
                onInput={(event) => readingSession.setHeaderMargin(readTtsMarginInput(event.currentTarget.value))}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px', 'margin-bottom': '12px' }}>
              <span style={{ display: 'flex', 'justify-content': 'space-between', 'font-size': '13px' }}>
                <span>Footer</span>
                <span>{readingSession.footerMargin()}px</span>
              </span>
              <input
                type="range"
                min={TTS_MARGIN_MIN}
                max={TTS_MARGIN_MAX}
                step={TTS_MARGIN_STEP}
                value={readingSession.footerMargin()}
                onInput={(event) => readingSession.setFooterMargin(readTtsMarginInput(event.currentTarget.value))}
              />
            </label>

            <div style={{ display: 'flex', 'justify-content': 'space-between', gap: '8px' }}>
              <button
                onClick={() => {
                  readingSession.setHeaderMargin(DEFAULT_HEADER_MARGIN);
                  readingSession.setFooterMargin(DEFAULT_FOOTER_MARGIN);
                }}
              >
                Reset
              </button>
              <button onClick={() => setShowMarginControls(false)}>Close</button>
            </div>
          </div>
        )}
      </div>

      <button onClick={props.onPrev}>⏮ Prev</button>
      <button onClick={props.onNext}>Next ⏭</button>
      <button 
        onClick={props.onPlay}
        style={{ 
          background: readingSession.isPlaying() ? '#ff4444' : '#4CAF50',
          color: 'white'
        }}
      >
        {readingSession.isPlaying() ? '⏸ Pause' : '▶ Play'}
      </button>
    </div>
  );
};

export default Toolbar;
