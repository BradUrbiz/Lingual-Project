import { useEffect, useRef, useState } from 'react';
import type { AvatarReaction, AvatarState } from '@/types/avatarChat';
import { DEFAULT_AVATAR_STATE } from '@/types/avatarChat';
import type {
  AvatarDiagnostics,
  AvatarPerformanceFrame,
} from './types';
import { LINGUAL_TUTOR_LIVE2D_MANIFEST } from './live2dManifest';
import {
  buildLive2DParameterTargets,
  resolveHitAreaName,
  type Live2DFocusPoint,
  type Live2DParameterTargets,
} from './live2dMapping';
import {
  chooseExpressionFromBanks,
  chooseMotionFromBanks,
} from './live2dSelection';
import { acquireCubismFramework } from './cubismRuntime';
import { OfficialCubismModel } from './OfficialCubismModel';

type Live2DAvatarPanelProps = {
  enabled?: boolean;
  title: string;
  statusLabel: string;
  avatarState?: AvatarState;
  avatarReaction?: AvatarReaction | null;
  performanceFrame?: AvatarPerformanceFrame | null;
  audioLevel?: number;
  avatarDiagnostics?: AvatarDiagnostics | null;
  fallbackSrc: string;
  onAvatarHit?: (area: string) => void;
};

type Live2DDebugSnapshot = {
  mouthOpen: number;
  emotionKey: string;
  expressionIds: string[];
  motionRefs: string[];
  targetParamA: number | null;
  targetParamI: number | null;
  targetParamU: number | null;
  targetParamE: number | null;
  targetParamO: number | null;
  actualParamA: number | null;
  actualParamI: number | null;
  actualParamU: number | null;
  actualParamE: number | null;
  actualParamO: number | null;
  directiveSource: string;
};

let live2DCorePromise: Promise<void> | null = null;

function ensureLive2DCoreScript(src: string) {
  if ((window as typeof window & { Live2DCubismCore?: unknown }).Live2DCubismCore) {
    return Promise.resolve();
  }

  if (live2DCorePromise) {
    return live2DCorePromise;
  }

  live2DCorePromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[data-live2d-core="${src}"]`);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Live2D Cubism Core')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.live2dCore = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Live2D Cubism Core'));
    document.head.appendChild(script);
  });

  return live2DCorePromise;
}

function buildDebugSnapshot(
  targets: Live2DParameterTargets,
  actualParams: Record<string, number | null>
): Live2DDebugSnapshot {
  return {
    mouthOpen: targets.debug.mouthOpen,
    emotionKey: targets.emotionKey,
    expressionIds: targets.expressionIds,
    motionRefs: targets.motionRefs,
    targetParamA: targets.values.ParamA ?? null,
    targetParamI: targets.values.ParamI ?? null,
    targetParamU: targets.values.ParamU ?? null,
    targetParamE: targets.values.ParamE ?? null,
    targetParamO: targets.values.ParamO ?? null,
    actualParamA: actualParams.ParamA ?? null,
    actualParamI: actualParams.ParamI ?? null,
    actualParamU: actualParams.ParamU ?? null,
    actualParamE: actualParams.ParamE ?? null,
    actualParamO: actualParams.ParamO ?? null,
    directiveSource: targets.debug.directiveSource,
  };
}

export default function Live2DAvatarPanel({
  enabled = true,
  title,
  statusLabel,
  avatarState = DEFAULT_AVATAR_STATE,
  avatarReaction = null,
  performanceFrame = null,
  audioLevel = 0,
  avatarDiagnostics = null,
  fallbackSrc,
  onAvatarHit,
}: Live2DAvatarPanelProps) {
  const manifest = LINGUAL_TUTOR_LIVE2D_MANIFEST;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<OfficialCubismModel | null>(null);
  const pointerFocusRef = useRef<Live2DFocusPoint>({ x: 0, y: 0 });
  const lastMotionRef = useRef<string | null>(null);
  const lastMotionTriggerKeyRef = useRef<string | null>(null);
  const lastMotionBankRef = useRef<string | null>(null);
  const lastExpressionRef = useRef<string | null>(null);
  const lastExpressionBankRef = useRef<string | null>(null);
  const lastExpressionChangedAtRef = useRef(0);
  const expressionHistoryRef = useRef<Map<string, number>>(new Map());
  const motionHistoryRef = useRef<Map<string, number>>(new Map());
  const lastFrameAtRef = useRef<number | null>(null);
  const localReactionTimeoutRef = useRef<number | null>(null);
  const avatarStateRef = useRef<AvatarState>(avatarState);
  const avatarReactionRef = useRef<AvatarReaction | null>(avatarReaction);
  const performanceRef = useRef<AvatarPerformanceFrame | null>(performanceFrame);
  const audioLevelRef = useRef(audioLevel);
  const diagnosticsRef = useRef<AvatarDiagnostics | null>(avatarDiagnostics);
  const localReactionRef = useRef<AvatarReaction | null>(null);
  const availableMotionGroupsRef = useRef<Record<string, number>>({});
  const availableExpressionsRef = useRef<string[]>([]);
  const latestTargetsRef = useRef<Live2DParameterTargets | null>(null);
  const showDebugRef = useRef(false);
  const lastDebugCommitAtRef = useRef(0);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [availableMotionGroups, setAvailableMotionGroups] = useState<string[]>([]);
  const [availableExpressions, setAvailableExpressions] = useState<string[]>([]);
  const [localReaction, setLocalReaction] = useState<AvatarReaction | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<Live2DDebugSnapshot | null>(null);

  useEffect(() => {
    avatarStateRef.current = avatarState;
  }, [avatarState]);

  useEffect(() => {
    avatarReactionRef.current = avatarReaction;
  }, [avatarReaction]);

  useEffect(() => {
    performanceRef.current = performanceFrame;
  }, [performanceFrame]);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    diagnosticsRef.current = avatarDiagnostics;
  }, [avatarDiagnostics]);

  useEffect(() => {
    localReactionRef.current = localReaction;
  }, [localReaction]);

  useEffect(() => {
    showDebugRef.current = showDebug;
  }, [showDebug]);

  useEffect(() => {
    return () => {
      if (localReactionTimeoutRef.current !== null) {
        window.clearTimeout(localReactionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled || !containerRef.current || !canvasRef.current) return;

    let cancelled = false;
    let frameId: number | null = null;
    let releaseFramework: (() => void) | null = null;
    let gl: WebGLRenderingContext | null = null;

    const canvas = canvasRef.current;
    const mountNode = containerRef.current;
    const motionHistory = motionHistoryRef.current;
    const expressionHistory = expressionHistoryRef.current;

    const resizeCanvas = () => {
      if (!gl) return;
      const devicePixelRatio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(mountNode.clientWidth * devicePixelRatio));
      const height = Math.max(1, Math.round(mountNode.clientHeight * devicePixelRatio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const clearFrame = () => {
      if (!gl) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1.0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    };

    const load = async () => {
      setLoadState('loading');
      setErrorMessage(null);

      try {
        await ensureLive2DCoreScript(manifest.coreScriptUrl);
        releaseFramework = acquireCubismFramework();

        gl = (canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true }) as WebGLRenderingContext | null)
          ?? canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });

        if (!gl) {
          throw new Error('WebGL is not available in this browser.');
        }

        const model = new OfficialCubismModel(gl);
        await model.load(manifest.modelJsonPath);

        if (cancelled) {
          model.release();
          return;
        }

        modelRef.current = model;
        availableMotionGroupsRef.current = model.getAvailableMotionGroups();
        availableExpressionsRef.current = model.getAvailableExpressions();
        setAvailableMotionGroups(Object.keys(availableMotionGroupsRef.current));
        setAvailableExpressions(availableExpressionsRef.current);
        resizeCanvas();
        model.resizeToCanvas(canvas.width, canvas.height, manifest);
        setLoadState('ready');

        const render = (now: number) => {
          if (cancelled || !modelRef.current) return;

          resizeCanvas();
          modelRef.current.resizeToCanvas(canvas.width, canvas.height, manifest);

          const effectiveReaction = localReactionRef.current ?? avatarReactionRef.current;
          const targets = buildLive2DParameterTargets({
            manifest,
            avatarState: avatarStateRef.current,
            avatarReaction: effectiveReaction,
            performance: performanceRef.current,
            audioLevel: audioLevelRef.current,
            pointerFocus: pointerFocusRef.current,
            now,
          });
          latestTargetsRef.current = targets;

          const motionTriggerKey = effectiveReaction
            ? `reaction:${effectiveReaction.motionGroup}:${effectiveReaction.area}`
            : `state:${avatarStateRef.current.dialogueState}:${targets.debug.motionKey}:${targets.emotionKey}:${targets.motionRefs.join('|')}`;
          const shouldRestartMotion = motionTriggerKey !== lastMotionTriggerKeyRef.current || modelRef.current.isMotionFinished();

          if (shouldRestartMotion) {
            const nextMotion = chooseMotionFromBanks(
              targets.motionRefs,
              availableMotionGroupsRef.current,
              manifest,
                motionHistory,
                lastMotionRef.current,
                now
              );
            if (nextMotion) {
              const started = effectiveReaction
                ? modelRef.current.startMotion(nextMotion.candidate.group, nextMotion.candidate.index ?? 0, 3)
                : avatarStateRef.current.dialogueState === 'idle'
                  ? modelRef.current.startIdleMotion(nextMotion.candidate.group, nextMotion.candidate.index ?? 0)
                  : modelRef.current.startMotion(nextMotion.candidate.group, nextMotion.candidate.index ?? 0, 2);

              if (started) {
                lastMotionRef.current = nextMotion.candidateKey;
                lastMotionBankRef.current = nextMotion.bankId;
                lastMotionTriggerKeyRef.current = motionTriggerKey;
                motionHistory.set(nextMotion.candidateKey, now);
              }
            }
          }

          const activeExpressionBank = targets.expressionIds[0] ?? null;
          const shouldPreserveExpression = (
            activeExpressionBank !== null &&
            activeExpressionBank === lastExpressionBankRef.current &&
            now - lastExpressionChangedAtRef.current < 420 &&
            lastExpressionRef.current !== null
          );

          if (!shouldPreserveExpression) {
            const nextExpression = chooseExpressionFromBanks(
              targets.expressionIds,
              availableExpressionsRef.current,
              manifest,
              expressionHistory,
              lastExpressionRef.current,
              now
            ) ?? (
              manifest.defaultExpression && availableExpressionsRef.current.includes(manifest.defaultExpression)
                ? {
                  bankId: 'default',
                  candidate: manifest.defaultExpression,
                  candidateKey: manifest.defaultExpression,
                }
                : null
            );

            if (nextExpression && nextExpression.candidate !== lastExpressionRef.current) {
              if (modelRef.current.setExpression(nextExpression.candidate)) {
                lastExpressionRef.current = nextExpression.candidate;
                lastExpressionBankRef.current = nextExpression.bankId;
                lastExpressionChangedAtRef.current = now;
                expressionHistory.set(nextExpression.candidateKey, now);
              }
            }
          }

          const lastFrameAt = lastFrameAtRef.current;
          const deltaSeconds = lastFrameAt === null ? 1 / 60 : (now - lastFrameAt) / 1000;
          lastFrameAtRef.current = now;

          modelRef.current.update(deltaSeconds, targets);
          clearFrame();
          modelRef.current.draw(canvas.width, canvas.height);

          if (import.meta.env.DEV && showDebugRef.current) {
            if (now - lastDebugCommitAtRef.current > 120) {
              lastDebugCommitAtRef.current = now;
              setDebugSnapshot(
                buildDebugSnapshot(
                  targets,
                  modelRef.current.getParameterValues(['ParamA', 'ParamI', 'ParamU', 'ParamE', 'ParamO'])
                )
              );
            }
          }

          frameId = window.requestAnimationFrame(render);
        };

        frameId = window.requestAnimationFrame(render);
      } catch (loadError) {
        setLoadState('error');
        setErrorMessage(loadError instanceof Error ? loadError.message : 'Failed to load Live2D avatar');
      }
    };

    void load();

    return () => {
      cancelled = true;

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      modelRef.current?.release();
      modelRef.current = null;
      releaseFramework?.();

      lastMotionRef.current = null;
      lastMotionTriggerKeyRef.current = null;
      lastMotionBankRef.current = null;
      lastExpressionRef.current = null;
      lastExpressionBankRef.current = null;
      lastExpressionChangedAtRef.current = 0;
      motionHistory.clear();
      expressionHistory.clear();
      lastFrameAtRef.current = null;
      latestTargetsRef.current = null;
      availableMotionGroupsRef.current = {};
      availableExpressionsRef.current = [];
      lastDebugCommitAtRef.current = 0;
      setAvailableMotionGroups([]);
      setAvailableExpressions([]);
      setDebugSnapshot(null);
    };
  }, [enabled, manifest, onAvatarHit]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const normalizedY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    pointerFocusRef.current = {
      x: Math.max(-1, Math.min(1, normalizedX)),
      y: Math.max(-1, Math.min(1, normalizedY)),
    };
  };

  const handlePointerLeave = () => {
    pointerFocusRef.current = { x: 0, y: 0 };
  };

  const handlePointerTap = (event: React.PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    const model = modelRef.current;
    if (!canvas || !model) return;

    const rect = canvas.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;
    const deviceX = (event.clientX - rect.left) * devicePixelRatio;
    const deviceY = (event.clientY - rect.top) * devicePixelRatio;
    const { x, y } = model.deviceToView(deviceX, deviceY, canvas.width, canvas.height);
    const hitAreas = model.hitTest(x, y);
    const firstArea = hitAreas[0] ?? 'body';
    const resolvedArea = resolveHitAreaName(manifest, firstArea);

    const instantReaction: AvatarReaction = {
      area: resolvedArea,
      affect: resolvedArea === 'head' || resolvedArea === 'face' ? 'curious' : 'affirming',
      motionGroup: resolvedArea === 'head'
        ? 'react_head'
        : resolvedArea === 'face'
          ? 'react_face'
          : 'react_body',
      subtitleText: resolvedArea === 'head' || resolvedArea === 'face' ? 'Oh?' : 'Ready.',
      durationMs: 700,
    };

    if (localReactionTimeoutRef.current !== null) {
      window.clearTimeout(localReactionTimeoutRef.current);
    }
    setLocalReaction(instantReaction);
    localReactionTimeoutRef.current = window.setTimeout(() => {
      setLocalReaction(null);
      localReactionTimeoutRef.current = null;
    }, instantReaction.durationMs);
    onAvatarHit?.(resolvedArea);
  };

  const effectiveReaction = localReaction ?? avatarReaction;
  const subtitleText = effectiveReaction?.subtitleText || avatarState.subtitleText;
  const diagnostics = diagnosticsRef.current;

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#fff8f1_0%,#f2ede7_48%,#e7dfd4_100%)]">
      <div
        ref={containerRef}
        className="relative flex-1"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerUp={handlePointerTap}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>

      {(loadState !== 'ready' || errorMessage) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/55 backdrop-blur-[2px]">
          <div className="pointer-events-auto flex max-w-xs flex-col items-center rounded-3xl border-3 border-foreground bg-card/95 px-5 py-6 text-center shadow-stamp">
            <img
              src={fallbackSrc}
              alt={title}
              className="mb-4 h-24 w-24 rounded-2xl border-3 border-foreground object-cover"
            />
            <p className="text-sm font-display font-bold text-foreground">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {loadState === 'loading' ? 'Loading Live2D runtime…' : 'Live2D model not available yet.'}
            </p>
            {errorMessage ? (
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{errorMessage}</p>
            ) : null}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5">
        <div className="rounded-3xl border-3 border-foreground bg-card/92 px-4 py-3 shadow-stamp backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">{title}</p>
              <p className="mt-1 text-sm font-bold text-foreground">{statusLabel}</p>
            </div>
            {import.meta.env.DEV ? (
              <button
                type="button"
                className="pointer-events-auto rounded-xl border-2 border-border bg-secondary px-2 py-1 text-[10px] font-bold text-muted-foreground"
                onClick={() => setShowDebug((previous) => !previous)}
              >
                {showDebug ? 'Hide Debug' : 'Debug'}
              </button>
            ) : null}
          </div>

          {subtitleText ? (
            <p className="mt-3 rounded-2xl border-2 border-border bg-white/70 px-3 py-2 text-sm leading-6 text-foreground">
              {subtitleText}
            </p>
          ) : null}
        </div>
      </div>

      {import.meta.env.DEV && showDebug ? (
        <div className="absolute right-4 top-4 w-80 rounded-2xl border-3 border-foreground bg-card/95 p-3 text-[11px] leading-5 shadow-stamp">
          <p className="font-black text-primary">Live2D Debug</p>
          <p className="mt-1 text-muted-foreground">State: {avatarState.dialogueState}</p>
          <p className="text-muted-foreground">Affect: {avatarState.affect}</p>
          <p className="text-muted-foreground">Motion: {avatarState.motionGroup}</p>
          <p className="text-muted-foreground">Feed audio: {(diagnostics?.audioLevel ?? audioLevel).toFixed(3)}</p>
          <p className="text-muted-foreground">RMS: {(diagnostics?.rmsLevel ?? 0).toFixed(4)}</p>
          <p className="text-muted-foreground">Remote audio: {diagnostics?.hasRemoteAudio ? 'yes' : 'no'}</p>
          <p className="text-muted-foreground">Speaking event: {diagnostics?.speakingEventState ?? 'idle'}</p>
          <p className="text-muted-foreground">Directive source: {diagnostics?.source ?? debugSnapshot?.directiveSource ?? 'fallback'}</p>
          <p className="text-muted-foreground">Mouth target: {(diagnostics?.mouthTarget ?? debugSnapshot?.mouthOpen ?? 0).toFixed(3)}</p>
          <p className="text-muted-foreground">
            Target A/I/U/E/O: {debugSnapshot?.targetParamA?.toFixed(2) ?? 'n/a'} / {debugSnapshot?.targetParamI?.toFixed(2) ?? 'n/a'} / {debugSnapshot?.targetParamU?.toFixed(2) ?? 'n/a'} / {debugSnapshot?.targetParamE?.toFixed(2) ?? 'n/a'} / {debugSnapshot?.targetParamO?.toFixed(2) ?? 'n/a'}
          </p>
          <p className="text-muted-foreground">
            Actual A/I/U/E/O: {debugSnapshot?.actualParamA?.toFixed(2) ?? 'n/a'} / {debugSnapshot?.actualParamI?.toFixed(2) ?? 'n/a'} / {debugSnapshot?.actualParamU?.toFixed(2) ?? 'n/a'} / {debugSnapshot?.actualParamE?.toFixed(2) ?? 'n/a'} / {debugSnapshot?.actualParamO?.toFixed(2) ?? 'n/a'}
          </p>
          <p className="text-muted-foreground">Emotion key: {debugSnapshot?.emotionKey ?? 'n/a'}</p>
          <p className="text-muted-foreground">Load: {loadState}</p>
          <p className="mt-2 font-bold text-foreground">Expressions</p>
          <p className="text-muted-foreground">{availableExpressions.join(', ') || 'none'}</p>
          <p className="mt-2 font-bold text-foreground">Expression banks</p>
          <p className="text-muted-foreground">{debugSnapshot?.expressionIds.join(', ') || 'none'}</p>
          <p className="mt-2 font-bold text-foreground">Motion groups</p>
          <p className="max-h-20 overflow-auto text-muted-foreground">{availableMotionGroups.join(', ') || 'none'}</p>
          <p className="mt-2 font-bold text-foreground">Motion banks</p>
          <p className="max-h-20 overflow-auto text-muted-foreground">{debugSnapshot?.motionRefs.join(', ') || 'none'}</p>
          {diagnostics?.lastExplicitDirective ? (
            <>
              <p className="mt-2 font-bold text-foreground">Last directive</p>
              <p className="text-muted-foreground">{JSON.stringify(diagnostics.lastExplicitDirective)}</p>
            </>
          ) : null}
          {effectiveReaction ? (
            <>
              <p className="mt-2 font-bold text-foreground">Reaction</p>
              <p className="text-muted-foreground">{effectiveReaction.area} / {effectiveReaction.motionGroup}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
