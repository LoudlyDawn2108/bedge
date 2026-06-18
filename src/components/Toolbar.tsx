import { createSignal, type Component } from 'solid-js';
import { pdfStore } from '../stores/pdfStore';
import { DEFAULT_FOOTER_MARGIN, DEFAULT_HEADER_MARGIN, readingSession } from '../stores/readingSessionStore';
import { TtsMarginControls } from './TtsMarginControls';

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
            <TtsMarginControls
              headerMargin={readingSession.headerMargin()}
              footerMargin={readingSession.footerMargin()}
              onHeaderMarginChange={readingSession.setHeaderMargin}
              onFooterMarginChange={readingSession.setFooterMargin}
              onReset={() => {
                readingSession.setHeaderMargin(DEFAULT_HEADER_MARGIN);
                readingSession.setFooterMargin(DEFAULT_FOOTER_MARGIN);
              }}
            />

            <div style={{ display: 'flex', 'justify-content': 'flex-end', gap: '8px', 'margin-top': '10px' }}>
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
