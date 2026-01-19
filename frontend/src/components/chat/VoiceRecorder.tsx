interface VoiceRecorderProps {
  isRecording: boolean;
  onToggleRecording: () => void;
  disabled?: boolean;
}

export function VoiceRecorder({
  isRecording,
  onToggleRecording,
  disabled = false,
}: VoiceRecorderProps) {
  return (
    <button
      onClick={onToggleRecording}
      disabled={disabled}
      className={`w-16 h-16 flex items-center justify-center rounded-full transition-all ${
        isRecording
          ? 'bg-red-500 animate-pulse-recording'
          : 'bg-success hover:bg-success/90'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
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
  );
}
