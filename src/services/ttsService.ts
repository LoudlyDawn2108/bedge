// Edge TTS Service using @andresaya/edge-tts
// High-quality Microsoft neural voices via Edge TTS

import { EdgeTTS } from '@andresaya/edge-tts';

export interface Voice {
  name: string;
  shortName: string;
  lang: string;
  gender: 'Male' | 'Female';
}

// Default voice - high quality neural voice
const DEFAULT_VOICE = 'en-US-AndrewMultilingualNeural';

class TTSService {
  private currentVoice: string = DEFAULT_VOICE;
  private currentAudio: HTMLAudioElement | null = null;
  private voicesCache: Voice[] | null = null;
  private aborted: boolean = false; // Flag to abort ongoing synthesis
  private synthesisId: number = 0; // Track current synthesis to invalidate stale ones
  
  async getVoices(): Promise<Voice[]> {
    if (this.voicesCache) return this.voicesCache;
    
    try {
      // EdgeTTS.getVoices() returns list of available voices
      const tts = new EdgeTTS();
      const voices = await tts.getVoices();
      this.voicesCache = voices.map((v: any) => ({
        name: v.FriendlyName || v.Name,
        shortName: v.ShortName,
        lang: v.Locale,
        gender: v.Gender as 'Male' | 'Female'
      }));
      return this.voicesCache;
    } catch (e) {
      console.error('Failed to fetch voices:', e);
      return [];
    }
  }
  
  async getVoicesFiltered(lang?: string, gender?: 'Male' | 'Female'): Promise<Voice[]> {
    const voices = await this.getVoices();
    return voices.filter(v => {
      if (lang && !v.lang.startsWith(lang)) return false;
      if (gender && v.gender !== gender) return false;
      return true;
    });
  }
  
  setVoice(shortName: string): void {
    this.currentVoice = shortName;
  }
  
  getVoice(): string {
    return this.currentVoice;
  }
  
  async speak(text: string): Promise<void> {
    // Increment synthesis ID to invalidate any previous pending synthesis
    // const currentSynthesisId = ++this.synthesisId;
    this.synthesisId++;
    this.aborted = false;
    
    return new Promise(async (resolve, reject) => {
      try {
        // Stop any current playback
        this.stop();
        const currentSynthesisId = this.synthesisId;
        this.aborted = false; // Reset after stop (stop sets it to true)
        
        // Create new EdgeTTS instance for this synthesis
        const tts = new EdgeTTS();
        
        // Use streaming to get audio chunks
        const chunks: Uint8Array[] = [];
        
        for await (const chunk of tts.synthesizeStream(text, this.currentVoice)) {
          // Check if aborted during streaming
          if (this.aborted || this.synthesisId !== currentSynthesisId) {
            resolve(); // Silently resolve - don't play
            return;
          }
          chunks.push(chunk);
        }
        
        // Check again after synthesis completes but before playing
        if (this.aborted || this.synthesisId !== currentSynthesisId) {
          resolve(); // Silently resolve - don't play
          return;
        }
        
        // Combine all chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const audioData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          audioData.set(chunk, offset);
          offset += chunk.length;
        }
        
        // Create blob and audio element
        const blob = new Blob([audioData], { type: 'audio/mp3' });
        const audioUrl = URL.createObjectURL(blob);
        
        // Final check before creating audio
        if (this.aborted || this.synthesisId !== currentSynthesisId) {
          URL.revokeObjectURL(audioUrl);
          resolve();
          return;
        }
        
        this.currentAudio = new Audio(audioUrl);
        
        this.currentAudio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          resolve();
        };
        
        this.currentAudio.onerror = (e) => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          reject(new Error(`Audio playback error: ${e}`));
        };
        
        // Final check before play
        if (this.aborted || this.synthesisId !== currentSynthesisId) {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          resolve();
          return;
        }
        
        await this.currentAudio.play();
        
      } catch (e) {
        reject(e);
      }
    });
  }
  
  stop(): void {
    this.aborted = true;
    this.synthesisId++; // Invalidate any pending synthesis
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }
  
  pause(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
    }
  }
  
  resume(): void {
    if (this.currentAudio) {
      this.currentAudio.play();
    }
  }
  
  isPlaying(): boolean {
    return this.currentAudio !== null && !this.currentAudio.paused;
  }
  
  isPaused(): boolean {
    return this.currentAudio !== null && this.currentAudio.paused;
  }
}

export const ttsService = new TTSService();
