import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';

interface AudioQuestionProps {
  wordList?: string[];
  sentences?: string[];
  onTranscriptChange: (transcript: string) => void;
}

export function AudioQuestion({
  wordList,
  sentences,
  onTranscriptChange,
}: AudioQuestionProps) {
  const { isRecording, startRecording, stopRecording, error } = useVoiceRecorder();

  const handleToggleRecording = async () => {
    if (isRecording) {
      stopRecording();
      // For now, we'll just set a placeholder since we don't have transcription
      onTranscriptChange('[Audio recorded]');
    } else {
      await startRecording();
    }
  };

  return (
    <div className="space-y-4">
      {wordList && wordList.length > 0 && (
        <div className="rounded-2xl border-2 border-border bg-secondary p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Warm-up words</p>
          <div className="flex flex-wrap gap-2">
            {wordList.map((word) => (
              <span
                key={word}
                className="px-3 py-1 bg-card rounded-full text-foreground text-sm border border-border"
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      )}

      {sentences && sentences.length > 0 && (
        <div className="rounded-2xl border-2 border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Read aloud</p>
          <div className="space-y-2">
            {sentences.map((sentence) => (
              <p key={sentence} className="text-foreground text-lg">
                {sentence}
              </p>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border-2 border-destructive/30 text-destructive px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div className="flex flex-col items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleToggleRecording}
          aria-pressed={isRecording}
          aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          className={`w-16 h-16 flex items-center justify-center rounded-full border-2 border-foreground transition-all shadow-stamp-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${
            isRecording
              ? 'bg-destructive text-destructive-foreground animate-pulse-recording'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          <svg
            className="size-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {isRecording ? (
              <rect x="6" y="6" width="12" height="12" strokeWidth="2" fill="currentColor" />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            )}
          </svg>
        </button>

        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">
            {isRecording ? 'Recording…' : 'Record your response'}
          </p>
          <p className="text-xs text-muted-foreground">
            {isRecording ? 'Click to stop and save.' : 'Tap to start recording.'}
          </p>
        </div>
      </div>
    </div>
  );
}
