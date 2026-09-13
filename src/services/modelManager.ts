import * as FileSystem from "expo-file-system/legacy";

/**
 * The quantised multilingual tiny model. ~31 MB, small enough to fetch once on
 * a phone and fast enough to transcribe faster than real time on modern
 * hardware. The `.en` variants are English-only, which would break the app's
 * multilingual promise.
 */
const MODEL_FILE = "ggml-tiny-q5_1.bin";
const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin";

/** Below this the file is a truncated or errored download, not a model. */
const MIN_PLAUSIBLE_BYTES = 25 * 1024 * 1024;

const modelDirectory = () =>
  `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory}models/`;

export const modelPath = () => `${modelDirectory()}${MODEL_FILE}`;

export interface ModelStatus {
  ready: boolean;
  sizeBytes?: number;
}

/**
 * Whether a usable model is already on disk.
 *
 * Size is checked rather than mere existence: an interrupted download leaves a
 * short file behind, and handing that to whisper produces a native crash rather
 * than a catchable error.
 */
export const getModelStatus = async (): Promise<ModelStatus> => {
  try {
    const info = await FileSystem.getInfoAsync(modelPath());
    if (!info.exists) return { ready: false };
    const size = "size" in info ? (info.size as number) : 0;
    return { ready: size >= MIN_PLAUSIBLE_BYTES, sizeBytes: size };
  } catch {
    return { ready: false };
  }
};

export interface DownloadProgress {
  /** 0 to 1, or null while the server has not reported a total. */
  fraction: number | null;
  receivedBytes: number;
  totalBytes: number;
}

/**
 * Fetches the model once and keeps it in app storage.
 *
 * This is the only network request the app makes, it carries no video, no
 * audio and no personal data, and it must be disclosed in the privacy policy
 * and the store data declarations.
 */
export const downloadModel = async (
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> => {
  await FileSystem.makeDirectoryAsync(modelDirectory(), {
    intermediates: true,
  }).catch(() => undefined);

  const destination = modelPath();
  // Download beside the target and move on success, so an interrupted attempt
  // can never be mistaken for a complete model.
  const staging = `${destination}.partial`;
  await FileSystem.deleteAsync(staging, { idempotent: true }).catch(
    () => undefined,
  );

  const resumable = FileSystem.createDownloadResumable(
    MODEL_URL,
    staging,
    {},
    (progress) => {
      const total = progress.totalBytesExpectedToWrite;
      onProgress?.({
        fraction: total > 0 ? progress.totalBytesWritten / total : null,
        receivedBytes: progress.totalBytesWritten,
        totalBytes: total,
      });
    },
  );

  const result = await resumable.downloadAsync();
  if (!result?.uri) {
    throw new Error("The speech model download did not complete.");
  }

  const info = await FileSystem.getInfoAsync(staging);
  const size = info.exists && "size" in info ? (info.size as number) : 0;
  if (size < MIN_PLAUSIBLE_BYTES) {
    await FileSystem.deleteAsync(staging, { idempotent: true }).catch(
      () => undefined,
    );
    throw new Error(
      "The speech model download was incomplete. Please try again.",
    );
  }

  await FileSystem.moveAsync({ from: staging, to: destination });
};

export const deleteModel = async (): Promise<void> => {
  await FileSystem.deleteAsync(modelPath(), { idempotent: true }).catch(
    () => undefined,
  );
};
