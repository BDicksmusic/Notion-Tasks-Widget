import { Buffer } from 'node:buffer';
import { fetch, File, FormData, type Response } from 'undici';
import type {
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult
} from '../../shared/types';

export interface WhisperTranscriptionRequest extends SpeechTranscriptionRequest {
  apiKey: string;
}

const DEFAULT_WHISPER_MODEL = 'whisper-1';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB limit from OpenAI

export async function transcribeWithWhisper(
  request: WhisperTranscriptionRequest
): Promise<SpeechTranscriptionResult> {
  if (!request.apiKey?.trim()) {
    throw new Error('Missing OpenAI API key for Whisper transcription');
  }

  if (!request.audioBase64) {
    throw new Error('Missing audio payload for transcription');
  }

  const audioBuffer = Buffer.from(request.audioBase64, 'base64');
  if (audioBuffer.byteLength === 0) {
    throw new Error('Received empty audio payload');
  }

  if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(
      `Audio payload exceeds ${Math.floor(MAX_AUDIO_BYTES / (1024 * 1024))}MB limit`
    );
  }

  const mimeType = request.mimeType || 'audio/webm';
  const extension = mimeTypeToExtension(mimeType);
  const filename = `speech-${Date.now()}.${extension}`;
  const file = new File([audioBuffer], filename, { type: mimeType });

  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', request.model ?? DEFAULT_WHISPER_MODEL);
  formData.append('response_format', 'verbose_json');

  if (request.language) {
    formData.append('language', request.language);
  }

  if (request.prompt) {
    formData.append('prompt', request.prompt);
  }

  const response = await fetch(
    'https://api.openai.com/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`
      },
      body: formData
    }
  );

  if (!response.ok) {
    const errorPayload = await safeParseJson(response);
    const message =
      typeof errorPayload?.error?.message === 'string'
        ? errorPayload.error.message
        : await response.text();
    throw new Error(
      `Whisper transcription failed (${response.status}): ${message}`
    );
  }

  const payload = (await response.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{
      text: string;
      start?: number;
      end?: number;
      no_speech_prob?: number;
      avg_logprob?: number;
    }>;
  };

  return {
    text: payload.text ?? '',
    language: payload.language,
    duration: typeof payload.duration === 'number' ? payload.duration : undefined,
    provider: 'openai',
    segments: payload.segments?.map((segment) => ({
      text: segment.text,
      start: segment.start,
      end: segment.end,
      confidence:
        typeof segment.avg_logprob === 'number'
          ? Math.min(
              1,
              Math.max(
                0,
                // avg_logprob is between -inf and 0, convert to 0-1 heuristic
                1 + segment.avg_logprob / 5
              )
            )
          : segment.no_speech_prob
    }))
  };
}

function mimeTypeToExtension(mime: string): string {
  switch (mime) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
      return 'm4a';
    default:
      return 'webm';
  }
}

async function safeParseJson(
  response: Response
): Promise<{ error?: { message?: string } } | null> {
  try {
    return (await response.json()) as {
      error?: { message?: string };
    };
  } catch {
    return null;
  }
}

