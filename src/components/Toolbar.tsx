import { createSignal, createEffect, onCleanup, type Component } from 'solid-js';
import { Volume2 } from 'lucide-solid';
import { pdfStore } from '../stores/pdfStore';
import { DEFAULT_FOOTER_MARGIN, DEFAULT_HEADER_MARGIN, readingSession } from '../stores/readingSessionStore';
import { TtsControls } from './TtsControls';

interface Props {
  onOpenFile: () => void;
  onOpenLibrary: () => void;
  onPlay: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export const Toolbar: Component<Props> = (props) => {
  const [showTtsControls, setShowTtsControls] = createSignal(false);
  const [zoomInputValue, setZoomInputValue] = createSignal(
    `${Math.round(pdfStore.zoomLevel() * 100)}`
  );
  const [isEditingZoom, setIsEditingZoom] = createSignal(false);
  let ttsContainerRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!showTtsControls()) return;

    const handleOutsideClick = (event: Event) => {
      const target = event.target as Node | null;
      const path = event.composedPath ? event.composedPath() : [];
      if (ttsContainerRef && target && !ttsContainerRef.contains(target) && !path.includes(ttsContainerRef)) {
        setShowTtsControls(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowTtsControls(false);
      }
    };

    // Capture phase ensures outside clicks are caught reliably across all child elements/overlays
    document.addEventListener('pointerdown', handleOutsideClick, true);
    document.addEventListener('mousedown', handleOutsideClick, true);
    document.addEventListener('touchstart', handleOutsideClick, true);
    document.addEventListener('keydown', handleKeyDown);

    onCleanup(() => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
      document.removeEventListener('mousedown', handleOutsideClick, true);
      document.removeEventListener('touchstart', handleOutsideClick, true);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  createEffect(() => {
    if (!isEditingZoom()) {
      setZoomInputValue(`${Math.round(pdfStore.zoomLevel() * 100)}`);
    }
  });

  const commitZoomValue = () => {
    const parsedValue = parseInt(zoomInputValue().trim(), 10);
    if (!Number.isNaN(parsedValue)) {
      pdfStore.setZoomLevel(parsedValue / 100);
    }
    setZoomInputValue(`${Math.round(pdfStore.zoomLevel() * 100)}`);
    setIsEditingZoom(false);
  };

  const handleZoomInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitZoomValue();
      (event.target as HTMLInputElement).blur();
    }
  };

  const handleZoomInputBlur = () => {
    setZoomInputValue(`${Math.round(pdfStore.zoomLevel() * 100)}`);
    setIsEditingZoom(false);
  };

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
        <input
          type="text"
          value={zoomInputValue()}
          onInput={(event) => {
            setZoomInputValue((event.target as HTMLInputElement).value);
            setIsEditingZoom(true);
          }}
          onKeyDown={handleZoomInputKeyDown}
          onBlur={handleZoomInputBlur}
          style={{
            width: '56px',
            padding: '4px 6px',
            'text-align': 'center',
            'border-radius': '4px',
            border: '1px solid #555',
            color: '#fff',
            background: '#1f1f21'
          }}
          aria-label="Zoom percentage"
        />
        <span style={{ color: '#fff' }}>%</span>
        <button onClick={pdfStore.zoomIn}>+</button>
        
        <span style={{ color: '#fff', margin: '0 16px' }}>
          Page {pdfStore.currentPage() + 1} of {pdfStore.totalPages()}
        </span>
      </div>
      
      {/* Spacer */}
      <div style={{ flex: 1 }} />
      
      {/* Right side - TTS controls */}
      <div ref={ttsContainerRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setShowTtsControls((show) => !show)}
          style={{
            display: 'inline-flex',
            'align-items': 'center',
            gap: '6px',
            background: showTtsControls() ? '#454545' : undefined,
          }}
          aria-expanded={showTtsControls()}
          aria-haspopup="dialog"
          title="TTS voice, speed, and volume controls"
        >
          <Volume2 size={16} />
          <span>TTS Controls</span>
        </button>

        {showTtsControls() && (
          <div
            role="dialog"
            aria-label="TTS Controls"
            class="desktop-tts-popover"
          >
            <div class="desktop-tts-popover__header">
              <h3>Speech & Audio Settings</h3>
            </div>

            <TtsControls
              headerMargin={readingSession.headerMargin()}
              footerMargin={readingSession.footerMargin()}
              onHeaderMarginChange={readingSession.setHeaderMargin}
              onFooterMarginChange={readingSession.setFooterMargin}
              onResetMargins={() => {
                readingSession.setHeaderMargin(DEFAULT_HEADER_MARGIN);
                readingSession.setFooterMargin(DEFAULT_FOOTER_MARGIN);
              }}
            />
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

