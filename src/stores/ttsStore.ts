import { createSignal, createRoot } from 'solid-js';
import { EdgeTTS } from '@andresaya/edge-tts';
import {
  ttsService,
  type Voice,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
} from '../services/ttsService';
import { getSetting, setSetting } from '../services/db';

const SETTING_KEY_VOICE = 'tts_voice';
const SETTING_KEY_SPEED = 'tts_speed';
const SETTING_KEY_VOLUME = 'tts_volume';

// High-quality curated default voice list (covers popular languages immediately before async fetch)
export const FALLBACK_VOICES: Voice[] = [
  { name: 'Alvaro (Spanish)', shortName: 'es-ES-AlvaroNeural', lang: 'es-ES', gender: 'Male' },
  { name: 'Andrew (Multilingual)', shortName: 'en-US-AndrewMultilingualNeural', lang: 'en-US', gender: 'Male' },
  { name: 'Aria', shortName: 'en-US-AriaNeural', lang: 'en-US', gender: 'Female' },
  { name: 'Ava (Multilingual)', shortName: 'en-US-AvaMultilingualNeural', lang: 'en-US', gender: 'Female' },
  { name: 'Brian (Multilingual)', shortName: 'en-US-BrianMultilingualNeural', lang: 'en-US', gender: 'Male' },
  { name: 'Christopher', shortName: 'en-US-ChristopherNeural', lang: 'en-US', gender: 'Male' },
  { name: 'Elvira (Spanish)', shortName: 'es-ES-ElviraNeural', lang: 'es-ES', gender: 'Female' },
  { name: 'Emma (Multilingual)', shortName: 'en-US-EmmaMultilingualNeural', lang: 'en-US', gender: 'Female' },
  { name: 'Florian (German Multilingual)', shortName: 'de-DE-FlorianMultilingualNeural', lang: 'de-DE', gender: 'Male' },
  { name: 'Guy', shortName: 'en-US-GuyNeural', lang: 'en-US', gender: 'Male' },
  { name: 'HoaiMy (Vietnamese)', shortName: 'vi-VN-HoaiMyNeural', lang: 'vi-VN', gender: 'Female' },
  { name: 'Jenny', shortName: 'en-US-JennyNeural', lang: 'en-US', gender: 'Female' },
  { name: 'Keita (Japanese)', shortName: 'ja-JP-KeitaNeural', lang: 'ja-JP', gender: 'Male' },
  { name: 'NamMinh (Vietnamese)', shortName: 'vi-VN-NamMinhNeural', lang: 'vi-VN', gender: 'Male' },
  { name: 'Nanami (Japanese)', shortName: 'ja-JP-NanamiNeural', lang: 'ja-JP', gender: 'Female' },
  { name: 'Natasha (Australia)', shortName: 'en-AU-NatashaNeural', lang: 'en-AU', gender: 'Female' },
  { name: 'Remy (French Multilingual)', shortName: 'fr-FR-RemyMultilingualNeural', lang: 'fr-FR', gender: 'Male' },
  { name: 'Ryan (UK)', shortName: 'en-GB-RyanNeural', lang: 'en-GB', gender: 'Male' },
  { name: 'Seraphina (German Multilingual)', shortName: 'de-DE-SeraphinaMultilingualNeural', lang: 'de-DE', gender: 'Female' },
  { name: 'Sonia (UK)', shortName: 'en-GB-SoniaNeural', lang: 'en-GB', gender: 'Female' },
  { name: 'Vivienne (French Multilingual)', shortName: 'fr-FR-VivienneMultilingualNeural', lang: 'fr-FR', gender: 'Female' },
  { name: 'William (Australia)', shortName: 'en-AU-WilliamNeural', lang: 'en-AU', gender: 'Male' },
  { name: 'Xiaoxiao (Chinese)', shortName: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN', gender: 'Female' },
  { name: 'Yunxi (Chinese)', shortName: 'zh-CN-YunxiNeural', lang: 'zh-CN', gender: 'Male' },
];

export const SPEED_PRESETS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

function createTtsStore() {
  const [voice, setVoiceSignal] = createSignal<string>(DEFAULT_VOICE);
  const [speed, setSpeedSignal] = createSignal<number>(DEFAULT_RATE);
  const [volume, setVolumeSignal] = createSignal<number>(DEFAULT_VOLUME);
  const [voices, setVoices] = createSignal<Voice[]>(FALLBACK_VOICES);
  const [isLoadingVoices, setIsLoadingVoices] = createSignal(false);
  const [previewingVoice, setPreviewingVoice] = createSignal<string | null>(null);

  let activePreviewAudio: HTMLAudioElement | null = null;
  let activePreviewUrl: string | null = null;

  function stopPreview(): void {
    if (activePreviewAudio) {
      activePreviewAudio.pause();
      activePreviewAudio.currentTime = 0;
      activePreviewAudio = null;
    }
    if (activePreviewUrl) {
      URL.revokeObjectURL(activePreviewUrl);
      activePreviewUrl = null;
    }
    setPreviewingVoice(null);
  }

  async function previewVoice(voiceShortName: string, sampleText: string = 'Hello! This is a preview of the Microsoft Edge neural voice.'): Promise<void> {
    stopPreview();
    setPreviewingVoice(voiceShortName);

    try {
      const tts = new EdgeTTS();
      const currentRate = speed();
      const currentVol = volume();
      const ratePercentage = Math.round((currentRate - 1.0) * 100);
      const rateString = `${ratePercentage >= 0 ? '+' : ''}${ratePercentage}%`;

      const chunks: Uint8Array[] = [];
      for await (const chunk of tts.synthesizeStream(sampleText, voiceShortName, { rate: rateString })) {
        chunks.push(chunk);
      }

      if (previewingVoice() !== voiceShortName) return;

      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const audioData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        audioData.set(chunk, offset);
        offset += chunk.length;
      }

      const blob = new Blob([audioData], { type: 'audio/mp3' });
      const url = URL.createObjectURL(blob);
      activePreviewUrl = url;

      const audio = new Audio(url);
      audio.volume = currentVol;
      activePreviewAudio = audio;

      audio.onended = () => {
        stopPreview();
      };
      audio.onerror = () => {
        stopPreview();
      };

      await audio.play();
    } catch (error) {
      console.error('Failed to preview voice:', error);
      stopPreview();
    }
  }

  function setVoice(nextVoice: string): void {
    if (!nextVoice) return;
    setVoiceSignal(nextVoice);
    ttsService.setVoice(nextVoice);
    void setSetting(SETTING_KEY_VOICE, nextVoice).catch(error => {
      console.error('Failed to persist TTS voice:', error);
    });
  }

  function setSpeed(nextSpeed: number): void {
    const clamped = Math.max(0.5, Math.min(2.0, Math.round(nextSpeed * 100) / 100));
    setSpeedSignal(clamped);
    ttsService.setRate(clamped);
    void setSetting(SETTING_KEY_SPEED, String(clamped)).catch(error => {
      console.error('Failed to persist TTS speed:', error);
    });
  }

  function setVolume(nextVolume: number): void {
    const clamped = Math.max(0, Math.min(1, Math.round(nextVolume * 100) / 100));
    setVolumeSignal(clamped);
    ttsService.setVolume(clamped);
    if (activePreviewAudio) {
      activePreviewAudio.volume = clamped;
    }
    void setSetting(SETTING_KEY_VOLUME, String(clamped)).catch(error => {
      console.error('Failed to persist TTS volume:', error);
    });
  }

  async function loadVoices(): Promise<void> {
    setIsLoadingVoices(true);
    try {
      const fetchedVoices = await ttsService.getVoices();
      if (fetchedVoices && fetchedVoices.length > 0) {
        // Sort voices alphabetically by name
        const sorted = [...fetchedVoices].sort((a, b) => a.name.localeCompare(b.name) || a.lang.localeCompare(b.lang));
        setVoices(sorted);
      }
    } catch (error) {
      console.warn('Could not load remote voices list, using fallback voices:', error);
    } finally {
      setIsLoadingVoices(false);
    }
  }

  async function init(): Promise<void> {
    try {
      const [savedVoice, savedSpeed, savedVolume] = await Promise.all([
        getSetting(SETTING_KEY_VOICE, DEFAULT_VOICE),
        getSetting(SETTING_KEY_SPEED, String(DEFAULT_RATE)),
        getSetting(SETTING_KEY_VOLUME, String(DEFAULT_VOLUME)),
      ]);

      const parsedSpeed = parseFloat(savedSpeed);
      const parsedVolume = parseFloat(savedVolume);

      const activeVoice = savedVoice || DEFAULT_VOICE;
      const activeSpeed = Number.isFinite(parsedSpeed) ? parsedSpeed : DEFAULT_RATE;
      const activeVolume = Number.isFinite(parsedVolume) ? parsedVolume : DEFAULT_VOLUME;

      setVoiceSignal(activeVoice);
      setSpeedSignal(activeSpeed);
      setVolumeSignal(activeVolume);

      ttsService.setVoice(activeVoice);
      ttsService.setRate(activeSpeed);
      ttsService.setVolume(activeVolume);
    } catch (error) {
      console.error('Failed to initialize TTS settings:', error);
    }

    void loadVoices();
  }

  return {
    voice,
    speed,
    volume,
    voices,
    isLoadingVoices,
    previewingVoice,
    setVoice,
    setSpeed,
    setVolume,
    previewVoice,
    stopPreview,
    loadVoices,
    init,
  };
}

export const ttsStore = createRoot(createTtsStore);
