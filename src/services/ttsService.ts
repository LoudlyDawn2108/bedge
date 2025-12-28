// Web Speech API TTS Service
// Works in all modern browsers, best voice quality in MS Edge

export interface Voice {
  name: string;
  lang: string;
  voiceURI: string;
}

class TTSService {
  private synth: SpeechSynthesis;
  private currentVoice: SpeechSynthesisVoice | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private onEndCallback: (() => void) | null = null;
  
  constructor() {
    this.synth = window.speechSynthesis;
    
    // Voices may load asynchronously
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => {
        this.setDefaultVoice();
      };
    }
    
    // Try setting default voice immediately (may work if voices already loaded)
    this.setDefaultVoice();
  }
  
  private setDefaultVoice(): void {
    const voices = this.synth.getVoices();
    // Prefer Microsoft Edge neural voices
    const edgeVoice = voices.find(v => 
      v.name.includes('Microsoft') && v.name.includes('Online') && v.lang.startsWith('en')
    );
    const englishVoice = voices.find(v => v.lang.startsWith('en'));
    this.currentVoice = edgeVoice || englishVoice || voices[0] || null;
  }
  
  setVoice(voiceURI: string): void {
    const voices = this.synth.getVoices();
    const voice = voices.find(v => v.voiceURI === voiceURI);
    if (voice) {
      this.currentVoice = voice;
    }
  }
  
  getVoice(): string {
    return this.currentVoice?.voiceURI || '';
  }
  
  getVoices(): Voice[] {
    return this.synth.getVoices().map(v => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI
    }));
  }
  
  speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Cancel any ongoing speech
      this.stop();
      
      const utterance = new SpeechSynthesisUtterance(text);
      
      if (this.currentVoice) {
        utterance.voice = this.currentVoice;
      }
      
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      
      utterance.onend = () => {
        this.currentUtterance = null;
        resolve();
      };
      
      utterance.onerror = (event) => {
        this.currentUtterance = null;
        reject(new Error(`Speech error: ${event.error}`));
      };
      
      this.currentUtterance = utterance;
      this.synth.speak(utterance);
    });
  }
  
  stop(): void {
    this.synth.cancel();
    this.currentUtterance = null;
  }
  
  pause(): void {
    this.synth.pause();
  }
  
  resume(): void {
    this.synth.resume();
  }
  
  isPlaying(): boolean {
    return this.synth.speaking;
  }
  
  isPaused(): boolean {
    return this.synth.paused;
  }
}

export const ttsService = new TTSService();
