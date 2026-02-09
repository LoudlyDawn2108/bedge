import { Show, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PDFViewer } from './components/PDFViewer';
import { pdfService } from './services/pdfService';
import { ttsService } from './services/ttsService';
import { pdfStore } from './stores/pdfStore';
import { ttsStore } from './stores/ttsStore';
import { db, addBook, getBookByPath, updateBook, type Book } from './services/db';
import './App.css';

const App: Component = () => {
  const [showLibrary, setShowLibrary] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;
  let viewerRef: any;
  
  // Open file dialog
  function openFileDialog() {
    fileInputRef?.click();
  }
  
  // Handle file selection
  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    
    try {
      // Load PDF
      await pdfService.loadFromFile(file);
      pdfStore.setTotalPages(pdfService.numPages);
      pdfStore.clearLoadedPages();
      ttsStore.clearSentences();
      
      // Load TOC
      const toc = await pdfService.getTOC();
      pdfStore.setTOC(toc);
      
      // Check if book exists in DB
      let book = await getBookByPath(file.name);
      if (!book) {
        // Add new book
        const id = await addBook({
          path: file.name,
          title: file.name.replace('.pdf', ''),
          totalPages: pdfService.numPages,
          lastPage: 0,
          lastSentence: 0,
          zoomLevel: 2.5,
          headerMargin: 50,
          footerMargin: 60,
          columnMode: 1,
          lastOpened: Date.now(),
          pdfBlob: file
        });
        book = await db.books.get(id);
      } else {
        // Update last opened
        await updateBook(book.id!, { lastOpened: Date.now() });
      }
      
      if (book) {
        pdfStore.setCurrentBook(book);
        pdfStore.setZoomLevel(book.zoomLevel);
        ttsStore.setHeaderMargin(book.headerMargin);
        ttsStore.setFooterMargin(book.footerMargin);
        ttsStore.setColumnMode(book.columnMode);
      }
      
    } catch (err) {
      console.error('Failed to load PDF:', err);
      alert('Failed to load PDF: ' + (err as Error).message);
    }
    
    // Reset input
    input.value = '';
  }
  
  // TTS Playback
  let playbackAbort = false;
  
  async function togglePlay() {
    if (ttsStore.isPlaying()) {
      // Stop
      playbackAbort = true;
      ttsService.stop();
      ttsStore.setIsPlaying(false);
    } else {
      // Start
      playbackAbort = false;
      
      // Check if current sentence highlight is on the current visible page
      const currentSentence = ttsStore.getCurrentSentence();
      const currentVisiblePage = pdfStore.currentPage();
      
      // If no current sentence or current sentence is on a different page, 
      // try to jump to first sentence on the visible page
      if (!currentSentence || currentSentence.pageNum !== currentVisiblePage) {
        // Only jump if there are sentences for the current page
        const hasSentences = ttsStore.goToPageSentence(currentVisiblePage);
        if (!hasSentences && !currentSentence) {
          // No sentences for current page and no current sentence - nothing to play
          console.log('No sentences available for current page');
          return;
        }
        // If no sentences for target page but we have a current sentence, just continue from there
      }
      
      ttsStore.setIsPlaying(true);
      await runPlayback();
    }
  }
  
  async function runPlayback() {
    const sentences = ttsStore.sentences();
    
    while (ttsStore.currentSentenceIdx() < sentences.length && !playbackAbort) {
      const sentence = ttsStore.getCurrentSentence();
      if (!sentence) break;
      
      try {
        // Speak the sentence using Web Speech API
        await ttsService.speak(sentence.text);
        
        if (playbackAbort) break;
        
        // Move to next sentence
        ttsStore.nextSentence();
        
      } catch (err) {
        const errorMessage = (err as Error).message;
        // Ignore 'interrupted' errors - these happen when user presses stop/next/prev
        if (errorMessage.includes('interrupted') || errorMessage.includes('canceled')) {
          break;
        }
        console.error('TTS Error:', err);
        alert('TTS Error: ' + errorMessage);
        break;
      }
    }
    
    ttsStore.setIsPlaying(false);
  }
  
  function handlePrev() {
    if (ttsStore.isPlaying()) {
      playbackAbort = true;
      ttsService.stop();
      ttsStore.setIsPlaying(false);
    }
    ttsStore.prevSentence();
  }
  
  function handleNext() {
    if (ttsStore.isPlaying()) {
      playbackAbort = true;
      ttsService.stop();
      ttsStore.setIsPlaying(false);
    }
    ttsStore.nextSentence();
  }
  
  function handleTOCSelect(pageNum: number, y?: number) {
    pdfStore.goToPage(pageNum, y);
  }
  
  return (
    <div class="app" style={{
      display: 'flex',
      'flex-direction': 'column',
      height: '100vh',
      background: '#1e1e1e'
    }}>
      {/* Hidden file input */}
      <input 
        ref={fileInputRef}
        type="file" 
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      
      <Toolbar 
        onOpenFile={openFileDialog}
        onOpenLibrary={() => setShowLibrary(true)}
        onPlay={togglePlay}
        onPrev={handlePrev}
        onNext={handleNext}
      />
      
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar onSelectItem={handleTOCSelect} />
        
        <Show 
          when={pdfStore.totalPages() > 0}
          fallback={
            <div style={{
              flex: 1,
              display: 'flex',
              'flex-direction': 'column',
              'justify-content': 'center',
              'align-items': 'center',
              color: '#888',
              gap: '20px'
            }}>
              <div style={{ 'font-size': '48px' }}>📄</div>
              <div>Open a PDF to start reading</div>
              <button onClick={openFileDialog} style={{ 
                padding: '12px 24px', 
                'font-size': '16px',
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                'border-radius': '8px',
                cursor: 'pointer'
              }}>
                Open PDF
              </button>
            </div>
          }
        >
          <PDFViewer ref={viewerRef} />
        </Show>
      </div>
    </div>
  );
};

export default App;
