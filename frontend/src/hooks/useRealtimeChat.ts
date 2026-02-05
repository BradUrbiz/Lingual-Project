import { useState, useCallback, useRef, useEffect } from 'react';
import api from '../api';

interface RealtimeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface UseRealtimeChatOptions {
  onMessage?: (role: 'user' | 'assistant', content: string) => void;
}

interface UseRealtimeChatReturn {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  messages: RealtimeMessage[];
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  startListening: () => void;
  stopListening: () => void;
  clearMessages: () => void;
}

type RealtimeContentItem = {
  type?: string;
  transcript?: string;
};

type RealtimeItem = {
  id?: string;
  role?: string;
  type?: string;
  content?: RealtimeContentItem[];
};

type RealtimeServerEvent = {
  type: string;
  transcript?: string;
  item_id?: string;
  item?: RealtimeItem;
  session?: { input_audio_transcription?: unknown };
  response?: { id?: string };
  error?: { message?: string };
};

export function useRealtimeChat(options?: UseRealtimeChatOptions): UseRealtimeChatReturn {
  const onMessageCallback = options?.onMessage;
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<RealtimeMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Track processed item IDs to prevent duplicates
  const processedItemsRef = useRef<Set<string>>(new Set());
  // Track current response ID for interruption handling
  const currentResponseIdRef = useRef<string | null>(null);
  // Track if we're currently speaking (for interruption)
  const isSpeakingRef = useRef(false);

  const addMessage = useCallback((role: 'user' | 'assistant', content: string, itemId?: string) => {
    // If itemId provided, check for duplicates
    if (itemId) {
      if (processedItemsRef.current.has(itemId)) {
        console.log('Skipping duplicate item:', itemId);
        return;
      }
      processedItemsRef.current.add(itemId);
    }

    const message: RealtimeMessage = {
      id: itemId || Date.now().toString(),
      role,
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, message]);

    // Call the callback to save message to database
    if (onMessageCallback) {
      onMessageCallback(role, content);
    }
  }, [onMessageCallback]);

  // Cancel current response (for interruption)
  const cancelCurrentResponse = useCallback(() => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      // Send response.cancel to stop current AI response
      dataChannelRef.current.send(JSON.stringify({
        type: 'response.cancel'
      }));
      console.log('Cancelled current response');
    }
  }, []);

  const handleServerEvent = useCallback((event: RealtimeServerEvent) => {
    console.log('Server event:', event.type, event);

    switch (event.type) {
      case 'session.created':
        // Session started - clear processed items for new session
        processedItemsRef.current.clear();
        console.log('Session created, transcription enabled:', event.session?.input_audio_transcription);
        break;

      case 'conversation.item.created':
        // New conversation item - track the item ID
        if (event.item?.id) {
          console.log('New conversation item:', event.item.id, event.item.role, event.item.type);
        }
        break;

      case 'response.created':
        // Track current response for potential cancellation
        currentResponseIdRef.current = event.response?.id || null;
        break;

      case 'response.audio_transcript.done':
        // AI finished speaking - add transcript with item_id for deduplication
        console.log('AI transcript done:', event.transcript);
        if (event.transcript) {
          const itemId = event.item_id || `assistant-${Date.now()}`;
          addMessage('assistant', event.transcript, itemId);
        }
        break;

      case 'response.output_item.done':
        // Alternative: full output item with transcript
        console.log('Output item done:', event.item);
        if (event.item?.type === 'message' && event.item?.content) {
          const textContent = event.item.content.find((c) => c.type === 'audio' && c.transcript);
          if (textContent?.transcript) {
            const itemId = event.item.id || `assistant-${Date.now()}`;
            addMessage('assistant', textContent.transcript, itemId);
          }
        }
        break;

      case 'response.done':
        // Response complete
        currentResponseIdRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // User's speech transcribed - use item_id for deduplication
        console.log('User transcript completed:', event.transcript);
        if (event.transcript) {
          const itemId = event.item_id || `user-${Date.now()}`;
          addMessage('user', event.transcript, itemId);
        }
        break;

      case 'conversation.item.input_audio_transcription.failed':
        // Transcription failed
        console.error('User transcription failed:', event.error);
        break;

      case 'input_audio_buffer.speech_started':
        setIsListening(true);
        // If AI is currently speaking, interrupt it
        if (isSpeakingRef.current) {
          console.log('User interrupted AI - cancelling response');
          cancelCurrentResponse();
          isSpeakingRef.current = false;
          setIsSpeaking(false);
        }
        break;

      case 'input_audio_buffer.speech_stopped':
        setIsListening(false);
        break;

      case 'response.audio.delta':
        // Audio is being played - mark as speaking
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true;
          setIsSpeaking(true);
        }
        break;

      case 'response.audio.done':
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        break;

      case 'error':
        setError(event.error?.message || 'Unknown error');
        currentResponseIdRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        break;
    }
  }, [addMessage, cancelCurrentResponse]);

  const connect = useCallback(async () => {
    try {
      setError(null);

      // Get ephemeral token from our backend
      const tokenResponse = await api.post('/realtime/session');
      const { client_secret } = tokenResponse.data;

      if (!client_secret) {
        throw new Error('Failed to get session token');
      }

      // Create peer connection
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      // Create audio element for playback
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElementRef.current = audioEl;

      // Handle incoming audio track
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
        setIsSpeaking(true);
      };

      // Get user's microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Add audio track to peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Create data channel for events
      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;

      dc.onopen = () => {
        console.log('Data channel opened');
        setIsConnected(true);
      };

      dc.onmessage = (event) => {
        handleServerEvent(JSON.parse(event.data) as RealtimeServerEvent);
      };

      dc.onclose = () => {
        console.log('Data channel closed');
        setIsConnected(false);
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to OpenAI Realtime API
      const sdpResponse = await fetch(
        'https://api.openai.com/v1/realtime?model=gpt-realtime-mini',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${client_secret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        }
      );

      if (!sdpResponse.ok) {
        throw new Error(`Failed to connect: ${sdpResponse.status}`);
      }

      // Set remote description
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      console.log('Connected to OpenAI Realtime API');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setError(message);
      console.error('Realtime connection error:', err);
    }
  }, [handleServerEvent]);

  const disconnect = useCallback(() => {
    // Close data channel
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Clean up audio element
    if (audioElementRef.current) {
      audioElementRef.current.srcObject = null;
      audioElementRef.current = null;
    }

    // Reset all state
    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);

    // Clear tracking refs
    processedItemsRef.current.clear();
    currentResponseIdRef.current = null;
    isSpeakingRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const startListening = useCallback(() => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      // Send event to start listening
      dataChannelRef.current.send(JSON.stringify({
        type: 'input_audio_buffer.clear'
      }));
    }
  }, []);

  const stopListening = useCallback(() => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      // Commit audio buffer to trigger response
      dataChannelRef.current.send(JSON.stringify({
        type: 'input_audio_buffer.commit'
      }));
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    processedItemsRef.current.clear();
  }, []);

  return {
    isConnected,
    isListening,
    isSpeaking,
    messages,
    error,
    connect,
    disconnect,
    startListening,
    stopListening,
    clearMessages,
  };
}
