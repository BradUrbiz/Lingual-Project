import { useCallback, useEffect, useMemo, useReducer, useRef, type RefObject } from 'react';
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
import { useLazyRef } from '@/hooks/useLazyRef';

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

type Live2DDebugCounters = {
  totalFrames: number;
  directiveFrames: number;
  fallbackFrames: number;
  expressionSelectionCount: number;
  repeatedExpressionSelectionCount: number;
  motionSelectionCount: number;
  repeatedMotionSelectionCount: number;
};

type Live2DLoadState = 'idle' | 'loading' | 'ready' | 'error';

type Live2DPanelState = {
  loadState: Live2DLoadState;
  errorMessage: string | null;
  showDebug: boolean;
  availableMotionGroups: string[];
  availableExpressions: string[];
  localReaction: AvatarReaction | null;
  debugSnapshot: Live2DDebugSnapshot | null;
  debugCounters: Live2DDebugCounters;
};

type Live2DPanelAction =
  | { type: 'loading' }
  | { type: 'ready'; availableMotionGroups: string[]; availableExpressions: string[] }
  | { type: 'error'; errorMessage: string }
  | { type: 'reset' }
  | { type: 'setLocalReaction'; localReaction: AvatarReaction | null }
  | { type: 'toggleDebug' }
  | { type: 'debugUpdate'; debugSnapshot: Live2DDebugSnapshot; debugCounters: Live2DDebugCounters };

function createLive2DPanelState(): Live2DPanelState {
  return {
    loadState: 'idle',
    errorMessage: null,
    showDebug: false,
    availableMotionGroups: [],
    availableExpressions: [],
    localReaction: null,
    debugSnapshot: null,
    debugCounters: createLive2DDebugCounters(),
  };
}

function live2DPanelReducer(state: Live2DPanelState, action: Live2DPanelAction): Live2DPanelState {
  switch (action.type) {
    case 'loading':
      return { ...state, loadState: 'loading', errorMessage: null };
    case 'ready':
      return {
        ...state,
        loadState: 'ready',
        errorMessage: null,
        availableMotionGroups: action.availableMotionGroups,
        availableExpressions: action.availableExpressions,
      };
    case 'error':
      return { ...state, loadState: 'error', errorMessage: action.errorMessage };
    case 'reset':
      return {
        ...state,
        availableMotionGroups: [],
        availableExpressions: [],
        debugSnapshot: null,
        debugCounters: createLive2DDebugCounters(),
      };
    case 'setLocalReaction':
      return { ...state, localReaction: action.localReaction };
    case 'toggleDebug':
      return { ...state, showDebug: !state.showDebug };
    case 'debugUpdate':
      return {
        ...state,
        debugSnapshot: action.debugSnapshot,
        debugCounters: action.debugCounters,
      };
    default:
      return state;
  }
}

let live2DCorePromise: Promise<void> | null = null;

function createLive2DDebugCounters(): Live2DDebugCounters {
  return {
    totalFrames: 0,
    directiveFrames: 0,
    fallbackFrames: 0,
    expressionSelectionCount: 0,
    repeatedExpressionSelectionCount: 0,
    motionSelectionCount: 0,
    repeatedMotionSelectionCount: 0,
  };
}

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

function Live2DLoadingOverlay({
  fallbackSrc,
  title,
  loadState,
  errorMessage,
}: {
  fallbackSrc: string;
  title: string;
  loadState: Live2DLoadState;
  errorMessage: string | null;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/55 backdrop-blur-[2px]">
      <div className="pointer-events-auto flex max-w-xs flex-col items-center rounded-3xl border-3 border-foreground bg-card/95 px-5 py-6 text-center shadow-stamp">
        <img
          src={fallbackSrc}
          alt={title}
          className="mb-4 size-24 rounded-2xl border-3 border-foreground object-cover"
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
  );
}

function Live2DHud({
  hudRef,
  title,
  statusLabel,
  subtitleText,
  showDebug,
  onToggleDebug,
}: {
  hudRef: RefObject<HTMLDivElement | null>;
  title: string;
  statusLabel: string;
  subtitleText: string | undefined;
  showDebug: boolean;
  onToggleDebug: () => void;
}) {
  return (
    <div ref={hudRef} className="pointer-events-none absolute inset-x-0 bottom-0 p-5">
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
              onClick={onToggleDebug}
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
  );
}

function Live2DDebugPanel({
  avatarState,
  diagnostics,
  audioLevel,
  debugSnapshot,
  debugCounters,
  availableExpressions,
  availableMotionGroups,
  effectiveReaction,
  loadState,
}: {
  avatarState: AvatarState;
  diagnostics: AvatarDiagnostics | null;
  audioLevel: number;
  debugSnapshot: Live2DDebugSnapshot | null;
  debugCounters: Live2DDebugCounters;
  availableExpressions: string[];
  availableMotionGroups: string[];
  effectiveReaction: AvatarReaction | null;
  loadState: Live2DLoadState;
}) {
  return (
    <div className="absolute right-4 top-4 w-80 rounded-2xl border-3 border-foreground bg-card/95 p-3 text-[11px] leading-5 shadow-stamp">
      <p className="font-black text-primary">Live2D Debug</p>
      <p className="mt-1 text-muted-foreground">State: {avatarState.dialogueState}</p>
      <p className="text-muted-foreground">Affect: {avatarState.affect}</p>
      <p className="text-muted-foreground">Motion: {avatarState.motionGroup}</p>
      <p className="text-muted-foreground">Feed audio: {(diagnostics?.audioLevel ?? audioLevel).toFixed(3)}</p>
      <p className="text-muted-foreground">RMS: {(diagnostics?.rmsLevel ?? 0).toFixed(4)}</p>
      <p className="text-muted-foreground">Mouth drive: {(diagnostics?.mouthDrive ?? diagnostics?.mouthTarget ?? 0).toFixed(3)}</p>
      <p className="text-muted-foreground">Remote audio: {diagnostics?.hasRemoteAudio ? 'yes' : 'no'}</p>
      <p className="text-muted-foreground">Speaking event: {diagnostics?.speakingEventState ?? 'idle'}</p>
      <p className="text-muted-foreground">Directive mode requested: {diagnostics?.directiveRequested ? 'yes' : 'no'}</p>
      <p className="text-muted-foreground">Directive source: {diagnostics?.source ?? debugSnapshot?.directiveSource ?? 'fallback'}</p>
      <p className="text-muted-foreground">Mouth target: {(diagnostics?.mouthTarget ?? debugSnapshot?.mouthOpen ?? 0).toFixed(3)}</p>
      <p className="text-muted-foreground">
        Directive events / speech turns: {diagnostics?.stats.directiveEventCount ?? 0} / {diagnostics?.stats.assistantSpeechTurnCount ?? 0}
      </p>
      <p className="text-muted-foreground">
        Directive turns / fallback turns: {diagnostics?.stats.directiveSpeechTurnCount ?? 0} / {diagnostics?.stats.fallbackSpeechTurnCount ?? 0}
      </p>
      <p className="text-muted-foreground">Avatar hits: {diagnostics?.stats.avatarHitCount ?? 0}</p>
      <p className="text-muted-foreground">
        Renderer directive / fallback frames: {debugCounters.directiveFrames} / {debugCounters.fallbackFrames}
      </p>
      <p className="text-muted-foreground">
        Expression repeats: {debugCounters.repeatedExpressionSelectionCount} / {debugCounters.expressionSelectionCount}
      </p>
      <p className="text-muted-foreground">
        Motion repeats: {debugCounters.repeatedMotionSelectionCount} / {debugCounters.motionSelectionCount}
      </p>
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
  );
}

type RuntimeRef<T> = { current: T };

type UseLive2DModelRuntimeArgs = {
  canvasRef: RuntimeRef<HTMLCanvasElement | null>;
  clearLoadedModelRef: () => void;
  containerRef: RuntimeRef<HTMLDivElement | null>;
  debugCountersRef: RuntimeRef<Live2DDebugCounters>;
  dispatchPanel: (action: Live2DPanelAction) => void;
  enabled: boolean;
  expressionHistoryRef: RuntimeRef<Map<string, number>>;
  hudRef: RuntimeRef<HTMLDivElement | null>;
  manifest: typeof LINGUAL_TUTOR_LIVE2D_MANIFEST;
  motionHistoryRef: RuntimeRef<Map<string, number>>;
  refs: {
    audioLevelRef: RuntimeRef<number>;
    availableExpressionsRef: RuntimeRef<string[]>;
    availableMotionGroupsRef: RuntimeRef<Record<string, number>>;
    avatarReactionRef: RuntimeRef<AvatarReaction | null>;
    avatarStateRef: RuntimeRef<AvatarState>;
    diagnosticsRef: RuntimeRef<AvatarDiagnostics | null>;
    lastDebugCommitAtRef: RuntimeRef<number>;
    lastExpressionBankRef: RuntimeRef<string | null>;
    lastExpressionChangedAtRef: RuntimeRef<number>;
    lastExpressionRef: RuntimeRef<string | null>;
    lastFrameAtRef: RuntimeRef<number | null>;
    lastMotionBankRef: RuntimeRef<string | null>;
    lastMotionRef: RuntimeRef<string | null>;
    lastMotionTriggerKeyRef: RuntimeRef<string | null>;
    latestTargetsRef: RuntimeRef<Live2DParameterTargets | null>;
    localReactionRef: RuntimeRef<AvatarReaction | null>;
    modelRef: RuntimeRef<OfficialCubismModel | null>;
    performanceRef: RuntimeRef<AvatarPerformanceFrame | null>;
    pointerFocusRef: RuntimeRef<Live2DFocusPoint>;
    showDebugRef: RuntimeRef<boolean>;
  };
};

function useLive2DModelRuntime({
  canvasRef,
  clearLoadedModelRef,
  containerRef,
  debugCountersRef,
  dispatchPanel,
  enabled,
  expressionHistoryRef,
  hudRef,
  manifest,
  motionHistoryRef,
  refs,
}: UseLive2DModelRuntimeArgs) {
  useEffect(() => {
    if (!enabled || !containerRef.current || !canvasRef.current) return;

    let cancelled = false;
    let frameId: number | null = null;
    let releaseFramework: (() => void) | null = null;
    let gl: WebGLRenderingContext | null = null;
    let loadedModel: OfficialCubismModel | null = null;

    const canvas = canvasRef.current;
    const mountNode = containerRef.current;
    const motionHistory = motionHistoryRef.current;
    const expressionHistory = expressionHistoryRef.current;
    const resetRuntimeState = () => {
      refs.lastMotionRef.current = null;
      refs.lastMotionTriggerKeyRef.current = null;
      refs.lastMotionBankRef.current = null;
      refs.lastExpressionRef.current = null;
      refs.lastExpressionBankRef.current = null;
      refs.lastExpressionChangedAtRef.current = 0;
      motionHistory.clear();
      expressionHistory.clear();
      refs.lastFrameAtRef.current = null;
      refs.latestTargetsRef.current = null;
      debugCountersRef.current = createLive2DDebugCounters();
      refs.availableMotionGroupsRef.current = {};
      refs.availableExpressionsRef.current = [];
      refs.lastDebugCommitAtRef.current = 0;
    };
    const getViewportInsets = () => ({
      topInsetPx: 20,
      rightInsetPx: 20,
      bottomInsetPx: (hudRef.current?.offsetHeight ?? 0) + 20,
      leftInsetPx: 20,
    });

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
      dispatchPanel({ type: 'loading' });

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

        loadedModel = model;
        refs.modelRef.current = model;
        refs.availableMotionGroupsRef.current = model.getAvailableMotionGroups();
        refs.availableExpressionsRef.current = model.getAvailableExpressions();
        resizeCanvas();
        model.resizeToCanvas(canvas.width, canvas.height, manifest, getViewportInsets(), window.devicePixelRatio || 1);
        dispatchPanel({
          type: 'ready',
          availableMotionGroups: Object.keys(refs.availableMotionGroupsRef.current),
          availableExpressions: refs.availableExpressionsRef.current,
        });

        const render = (now: number) => {
          if (cancelled || !refs.modelRef.current) return;

          resizeCanvas();
          refs.modelRef.current.resizeToCanvas(canvas.width, canvas.height, manifest, getViewportInsets(), window.devicePixelRatio || 1);

          const effectiveReaction = refs.localReactionRef.current ?? refs.avatarReactionRef.current;
          const targets = buildLive2DParameterTargets({
            manifest,
            avatarState: refs.avatarStateRef.current,
            avatarReaction: effectiveReaction,
            performance: refs.performanceRef.current,
            audioLevel: refs.audioLevelRef.current,
            pointerFocus: refs.pointerFocusRef.current,
            now,
          });
          refs.latestTargetsRef.current = targets;

          const motionTriggerKey = effectiveReaction
            ? `reaction:${effectiveReaction.motionGroup}:${effectiveReaction.area}`
            : `state:${refs.avatarStateRef.current.dialogueState}:${targets.debug.motionKey}:${targets.emotionKey}:${targets.motionRefs.join('|')}`;
          const shouldRestartMotion = motionTriggerKey !== refs.lastMotionTriggerKeyRef.current || refs.modelRef.current.isMotionFinished();

          if (shouldRestartMotion) {
            const nextMotion = chooseMotionFromBanks(
              targets.motionRefs,
              refs.availableMotionGroupsRef.current,
              manifest,
              motionHistory,
              refs.lastMotionRef.current,
              now
            );
            if (nextMotion) {
              const started = effectiveReaction
                ? refs.modelRef.current.startMotion(nextMotion.candidate.group, nextMotion.candidate.index ?? 0, 3)
                : refs.avatarStateRef.current.dialogueState === 'idle'
                  ? refs.modelRef.current.startIdleMotion(nextMotion.candidate.group, nextMotion.candidate.index ?? 0)
                  : refs.modelRef.current.startMotion(nextMotion.candidate.group, nextMotion.candidate.index ?? 0, 2);

              if (started) {
                const previousMotion = refs.lastMotionRef.current;
                const counters = debugCountersRef.current;
                counters.motionSelectionCount += 1;
                if (previousMotion === nextMotion.candidateKey) {
                  counters.repeatedMotionSelectionCount += 1;
                }
                refs.lastMotionRef.current = nextMotion.candidateKey;
                refs.lastMotionBankRef.current = nextMotion.bankId;
                refs.lastMotionTriggerKeyRef.current = motionTriggerKey;
                motionHistory.set(nextMotion.candidateKey, now);
              }
            }
          }

          const activeExpressionBank = targets.expressionIds[0] ?? null;
          const shouldPreserveExpression = (
            activeExpressionBank !== null &&
            activeExpressionBank === refs.lastExpressionBankRef.current &&
            now - refs.lastExpressionChangedAtRef.current < 420 &&
            refs.lastExpressionRef.current !== null
          );

          if (!shouldPreserveExpression) {
            const nextExpression = chooseExpressionFromBanks(
              targets.expressionIds,
              refs.availableExpressionsRef.current,
              manifest,
              expressionHistory,
              refs.lastExpressionRef.current,
              now
            ) ?? (
              manifest.defaultExpression && refs.availableExpressionsRef.current.includes(manifest.defaultExpression)
                ? {
                  bankId: 'default',
                  candidate: manifest.defaultExpression,
                  candidateKey: manifest.defaultExpression,
                }
                : null
            );

            if (nextExpression && nextExpression.candidate !== refs.lastExpressionRef.current) {
              if (refs.modelRef.current.setExpression(nextExpression.candidate)) {
                const previousExpression = refs.lastExpressionRef.current;
                const counters = debugCountersRef.current;
                counters.expressionSelectionCount += 1;
                if (previousExpression === nextExpression.candidateKey) {
                  counters.repeatedExpressionSelectionCount += 1;
                }
                refs.lastExpressionRef.current = nextExpression.candidate;
                refs.lastExpressionBankRef.current = nextExpression.bankId;
                refs.lastExpressionChangedAtRef.current = now;
                expressionHistory.set(nextExpression.candidateKey, now);
              }
            }
          }

          const lastFrameAt = refs.lastFrameAtRef.current;
          const deltaSeconds = lastFrameAt === null ? 1 / 60 : (now - lastFrameAt) / 1000;
          refs.lastFrameAtRef.current = now;

          refs.modelRef.current.update(deltaSeconds, targets);
          clearFrame();
          refs.modelRef.current.draw(canvas.width, canvas.height);

          if (import.meta.env.DEV && refs.showDebugRef.current) {
            const counters = debugCountersRef.current;
            counters.totalFrames += 1;
            if (targets.debug.directiveSource === 'directive') {
              counters.directiveFrames += 1;
            } else {
              counters.fallbackFrames += 1;
            }
            if (now - refs.lastDebugCommitAtRef.current > 120) {
              refs.lastDebugCommitAtRef.current = now;
              dispatchPanel({
                type: 'debugUpdate',
                debugSnapshot: buildDebugSnapshot(
                  targets,
                  refs.modelRef.current.getParameterValues(['ParamA', 'ParamI', 'ParamU', 'ParamE', 'ParamO'])
                ),
                debugCounters: { ...counters },
              });
            }
          }

          frameId = window.requestAnimationFrame(render);
        };

        frameId = window.requestAnimationFrame(render);
      } catch (loadError) {
        dispatchPanel({
          type: 'error',
          errorMessage: loadError instanceof Error ? loadError.message : 'Failed to load Live2D avatar',
        });
      }
    };

    void load();

    return () => {
      cancelled = true;

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      loadedModel?.release();
      clearLoadedModelRef();
      releaseFramework?.();

      resetRuntimeState();
      dispatchPanel({ type: 'reset' });
    };
  }, [
    canvasRef,
    clearLoadedModelRef,
    containerRef,
    debugCountersRef,
    dispatchPanel,
    enabled,
    expressionHistoryRef,
    hudRef,
    manifest,
    motionHistoryRef,
    refs,
  ]);
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
  const hudRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<OfficialCubismModel | null>(null);
  const pointerFocusRef = useRef<Live2DFocusPoint>({ x: 0, y: 0 });
  const lastMotionRef = useRef<string | null>(null);
  const lastMotionTriggerKeyRef = useRef<string | null>(null);
  const lastMotionBankRef = useRef<string | null>(null);
  const lastExpressionRef = useRef<string | null>(null);
  const lastExpressionBankRef = useRef<string | null>(null);
  const lastExpressionChangedAtRef = useRef(0);
  const expressionHistoryRef = useLazyRef(() => new Map<string, number>());
  const motionHistoryRef = useLazyRef(() => new Map<string, number>());
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
  const debugCountersRef = useLazyRef(createLive2DDebugCounters);
  const showDebugRef = useRef(false);
  const lastDebugCommitAtRef = useRef(0);
  const [panelState, dispatchPanel] = useReducer(
    live2DPanelReducer,
    undefined,
    createLive2DPanelState
  );
  const {
    loadState,
    errorMessage,
    showDebug,
    availableMotionGroups,
    availableExpressions,
    localReaction,
    debugSnapshot,
    debugCounters,
  } = panelState;

  const clearLocalReactionTimeout = useCallback(() => {
    if (localReactionTimeoutRef.current !== null) {
      window.clearTimeout(localReactionTimeoutRef.current);
      localReactionTimeoutRef.current = null;
    }
  }, []);

  const clearLoadedModelRef = useCallback(() => {
    modelRef.current = null;
  }, []);

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
      clearLocalReactionTimeout();
    };
  }, [clearLocalReactionTimeout]);

  const runtimeRefs = useMemo(() => ({
    audioLevelRef,
    availableExpressionsRef,
    availableMotionGroupsRef,
    avatarReactionRef,
    avatarStateRef,
    diagnosticsRef,
    lastDebugCommitAtRef,
    lastExpressionBankRef,
    lastExpressionChangedAtRef,
    lastExpressionRef,
    lastFrameAtRef,
    lastMotionBankRef,
    lastMotionRef,
    lastMotionTriggerKeyRef,
    latestTargetsRef,
    localReactionRef,
    modelRef,
    performanceRef,
    pointerFocusRef,
    showDebugRef,
  }), [
    audioLevelRef,
    availableExpressionsRef,
    availableMotionGroupsRef,
    avatarReactionRef,
    avatarStateRef,
    diagnosticsRef,
    lastDebugCommitAtRef,
    lastExpressionBankRef,
    lastExpressionChangedAtRef,
    lastExpressionRef,
    lastFrameAtRef,
    lastMotionBankRef,
    lastMotionRef,
    lastMotionTriggerKeyRef,
    latestTargetsRef,
    localReactionRef,
    modelRef,
    performanceRef,
    pointerFocusRef,
    showDebugRef,
  ]);

  useLive2DModelRuntime({
    canvasRef,
    clearLoadedModelRef,
    containerRef,
    debugCountersRef,
    dispatchPanel,
    enabled,
    expressionHistoryRef,
    hudRef,
    manifest,
    motionHistoryRef,
    refs: runtimeRefs,
  });

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

    clearLocalReactionTimeout();
    dispatchPanel({ type: 'setLocalReaction', localReaction: instantReaction });
    localReactionTimeoutRef.current = window.setTimeout(() => {
      dispatchPanel({ type: 'setLocalReaction', localReaction: null });
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
        <Live2DLoadingOverlay
          fallbackSrc={fallbackSrc}
          title={title}
          loadState={loadState}
          errorMessage={errorMessage}
        />
      )}

      <Live2DHud
        hudRef={hudRef}
        title={title}
        statusLabel={statusLabel}
        subtitleText={subtitleText}
        showDebug={showDebug}
        onToggleDebug={() => dispatchPanel({ type: 'toggleDebug' })}
      />

      {import.meta.env.DEV && showDebug ? (
        <Live2DDebugPanel
          avatarState={avatarState}
          diagnostics={diagnostics}
          audioLevel={audioLevel}
          debugSnapshot={debugSnapshot}
          debugCounters={debugCounters}
          availableExpressions={availableExpressions}
          availableMotionGroups={availableMotionGroups}
          effectiveReaction={effectiveReaction}
          loadState={loadState}
        />
      ) : null}
    </div>
  );
}
