import { requireNativeModule, type EventSubscription } from 'expo-modules-core';
import type { BurnPlan } from '../../src/engine/captionLayout';

export interface VideoInfo {
  /** Seconds. */
  duration: number;
  /** Display size, with the camera's rotation already applied. A portrait
   *  iPhone clip is stored 1920x1080 with a 90-degree transform, and laying
   *  captions out against the stored size puts them off-screen. */
  width: number;
  height: number;
}

export interface AudioTrack {
  /** 16 kHz mono 16-bit WAV, which is the only thing whisper accepts. */
  uri: string;
  sampleRate: number;
}

export interface BurnResult {
  uri: string;
}

interface CaptionBurnerModule {
  getInfo(uri: string): Promise<VideoInfo>;
  /** Decodes the audio track to a WAV whisper can read. */
  extractAudio(uri: string): Promise<AudioTrack>;
  /** Renders the plan's captions into the video and returns the new file. */
  burn(uri: string, plan: string): Promise<BurnResult>;
  // Declared here rather than by extending NativeModule: expo-modules-core
  // exports that class as a value whose members an interface does not inherit,
  // so extending it silently loses the emitter API.
  addListener(
    event: 'onBurnProgress',
    listener: (payload: { progress: number }) => void,
  ): EventSubscription;
}

/**
 * On-device caption burn-in.
 *
 * AVFoundation on iOS, MediaCodec on Android. The spec called for FFmpeg to
 * extract audio and libass to render the captions, but ffmpeg-kit's binaries
 * were withdrawn from Maven and CocoaPods in 2025 -- the POM, the AAR and the
 * podspec all 404 -- so neither is installable. These are the platform APIs
 * underneath FFmpeg's own iOS and Android backends.
 *
 * `plan` is a JSON-encoded BurnPlan. It crosses the bridge as a string rather
 * than a record because the layout is one object with a fixed shape that the
 * native side reads whole; converting it field by field through the bridge's
 * record machinery adds a second place for the layout to be wrong.
 */
export const burner = requireNativeModule<CaptionBurnerModule>('CaptionBurner');

export const encodePlan = (plan: BurnPlan): string => JSON.stringify(plan);

/**
 * Progress of the burn, 0 to 1.
 *
 * Re-encoding a minute of 4K takes tens of seconds; a spinner with no number
 * over that long reads as a hang, so the export screen shows the real figure
 * the encoder reports rather than an animation.
 */
export const onBurnProgress = (listener: (progress: number) => void): EventSubscription =>
  burner.addListener('onBurnProgress', ({ progress }) => listener(progress));

export default burner;
