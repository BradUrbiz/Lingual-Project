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
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-3">Warm-up words</p>
          <div className="flex flex-wrap gap-2">
            {wordList.map((word, index) => (
              <span
                key={index}
                className="px-3 py-1 bg-white rounded-full text-slate-700 text-sm border border-slate-200"
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      )}

      {sentences && sentences.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-3">Read aloud</p>
          <div className="space-y-2">
            {sentences.map((sentence, index) => (
              <p key={index} className="text-slate-900 text-lg">
                {sentence}
              </p>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div className="flex flex-col items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleToggleRecording}
          aria-pressed={isRecording}
          className={`w-16 h-16 flex items-center justify-center rounded-full transition-all shadow-lg ring-4 ${
            isRecording
              ? 'bg-red-500 ring-red-100 animate-pulse-recording'
              : 'bg-purple-600 ring-purple-100 hover:bg-purple-700'
          }`}
        >
          <svg
            className="w-8 h-8 text-white"
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
          <p className="text-sm font-semibold text-slate-700">
            {isRecording ? 'Recording…' : 'Record your response'}
          </p>
          <p className="text-xs text-slate-500">
            {isRecording ? 'Click to stop and save.' : 'Tap to start recording.'}
          </p>
        </div>
      </div>
    </div>
  );
}
