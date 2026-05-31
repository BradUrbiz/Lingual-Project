import { useEffect, useMemo, useReducer, useRef } from 'react';
import {
  Box3,
  Clock,
  DirectionalLight,
  Euler,
  HemisphereLight,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanBoneName, VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import {
  getExpressionCapabilities,
  listResolvedExpressionKeys,
  resolveExpressionAliases,
  type AvatarExpressionAliases,
} from './expressionAliases';
import { clamp01 } from './rms';
import type { AvatarDialogueState, AvatarPerformanceFrame } from './types';

type BoneMotionState = {
  node: Object3D;
  position: Vector3;
  quaternion: Quaternion;
};

type VrmAvatarPanelProps = {
  enabled: boolean;
  performance: AvatarPerformanceFrame;
  modelUrl?: string;
  fallbackSrc?: string;
  statusLabel?: string;
  title?: string;
};

type PanelStatus = 'idle' | 'loading' | 'ready' | 'error';

type VrmPanelState = {
  status: PanelStatus;
  errorMessage: string | null;
  resolvedExpressionKeys: string[];
  showDebug: boolean;
};

type VrmPanelAction =
  | { type: 'loading' }
  | { type: 'ready'; resolvedExpressionKeys: string[] }
  | { type: 'error'; errorMessage: string }
  | { type: 'toggleDebug' };

function createInitialVrmPanelState(enabled: boolean, webglSupported: boolean): VrmPanelState {
  return {
    status: enabled && webglSupported ? 'loading' : 'idle',
    errorMessage: null,
    resolvedExpressionKeys: [],
    showDebug: false,
  };
}

function vrmPanelReducer(state: VrmPanelState, action: VrmPanelAction): VrmPanelState {
  switch (action.type) {
    case 'loading':
      return { ...state, status: 'loading', errorMessage: null };
    case 'ready':
      return {
        ...state,
        status: 'ready',
        errorMessage: null,
        resolvedExpressionKeys: action.resolvedExpressionKeys,
      };
    case 'error':
      return { ...state, status: 'error', errorMessage: action.errorMessage };
    case 'toggleDebug':
      return { ...state, showDebug: !state.showDebug };
    default:
      return state;
  }
}
type VrmHumanoidBoneAccess = {
  getNormalizedBoneNode?: (name: VRMHumanBoneName) => Object3D | null;
  getRawBoneNode?: (name: VRMHumanBoneName) => Object3D | null;
};
type VrmExpressionManagerAccess = {
  expressionMap?: Record<string, unknown>;
  setValue?: (name: string, value: number) => void;
};

const DEFAULT_MODEL_URL = '/avatars/lingual-teacher.vrm';
const CONTROLLED_EXPRESSION_CHANNELS: Array<keyof AvatarExpressionAliases> = [
  'mouthAa',
  'mouthIh',
  'mouthOu',
  'mouthEe',
  'mouthOh',
  'jaw',
  'happy',
  'relaxed',
  'surprised',
  'blink',
  'blinkLeft',
  'blinkRight',
  'lookLeft',
  'lookRight',
  'lookUp',
  'lookDown',
];

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function disposeMaterial(material: Material) {
  const maybeAnyMaterial = material as unknown as Record<string, unknown>;
  for (const value of Object.values(maybeAnyMaterial)) {
    if (value && typeof value === 'object' && value instanceof Texture) {
      value.dispose();
    }
  }
  material.dispose();
}

function deepDispose(object: Object3D) {
  object.traverse((child: Object3D) => {
    const mesh = child as Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = (mesh as unknown as { material?: Material | Material[] }).material;
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
      return;
    }
    disposeMaterial(material);
  });
}

function resolveBoneNode(vrm: VRM, boneName: VRMHumanBoneName): Object3D | null {
  const humanoid = (vrm as unknown as { humanoid?: unknown }).humanoid as VrmHumanoidBoneAccess | undefined;

  return humanoid?.getNormalizedBoneNode?.(boneName) ?? humanoid?.getRawBoneNode?.(boneName) ?? null;
}

function getBoneWorldPosition(vrm: VRM, boneName: VRMHumanBoneName): Vector3 | null {
  const boneNode = resolveBoneNode(vrm, boneName);
  if (!boneNode) return null;

  const position = new Vector3();
  boneNode.getWorldPosition(position);
  return position;
}

function captureBoneMotionState(vrm: VRM, boneName: VRMHumanBoneName): BoneMotionState | null {
  const node = resolveBoneNode(vrm, boneName);
  if (!node) return null;

  return {
    node,
    position: node.position.clone(),
    quaternion: node.quaternion.clone(),
  };
}

function frameCameraToBust(vrm: VRM, camera: PerspectiveCamera) {
  const head = getBoneWorldPosition(vrm, VRMHumanBoneName.Head);
  const chest =
    getBoneWorldPosition(vrm, VRMHumanBoneName.UpperChest) ??
    getBoneWorldPosition(vrm, VRMHumanBoneName.Chest) ??
    getBoneWorldPosition(vrm, VRMHumanBoneName.Spine);

  if (head && chest) {
    const target = chest.clone().lerp(head, 1.25);
    const torso = Math.max(0.12, head.distanceTo(chest));
    const distance = torso * 3.5;

    camera.position.set(target.x, target.y, target.z + distance);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    return;
  }

  const box = new Box3().setFromObject(vrm.scene);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const target = center.clone();
  target.y += size.y * 0.2;

  const maxDim = Math.max(size.x, size.y, size.z);
  const halfFovRadians = MathUtils.degToRad(camera.fov / 2);
  const distance = maxDim / Math.tan(halfFovRadians);

  camera.position.set(center.x, target.y, center.z + distance * 0.65);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function resolveExpressionManager(vrm: VRM): VrmExpressionManagerAccess | null {
  return (
    ((vrm as unknown as { expressionManager?: unknown }).expressionManager as VrmExpressionManagerAccess | undefined) ??
    ((vrm as unknown as { blendShapeProxy?: unknown }).blendShapeProxy as VrmExpressionManagerAccess | undefined) ??
    null
  );
}

function setExpressionValue(manager: VrmExpressionManagerAccess | null, key: string | null, value: number) {
  if (!manager?.setValue || !key) return;

  try {
    manager.setValue(key, clamp01(value));
  } catch {
    // Ignore unsupported keys on older VRM implementations.
  }
}

function resetControlledExpressions(
  manager: VrmExpressionManagerAccess | null,
  aliases: AvatarExpressionAliases
) {
  for (const channel of CONTROLLED_EXPRESSION_CHANNELS) {
    setExpressionValue(manager, aliases[channel], 0);
  }
}

function applyMouthExpressions(
  manager: VrmExpressionManagerAccess | null,
  aliases: AvatarExpressionAliases,
  frame: AvatarPerformanceFrame
) {
  setExpressionValue(manager, aliases.mouthAa, frame.jawOpen * 0.95);
  setExpressionValue(manager, aliases.mouthIh, frame.mouthSpread * 0.45);
  setExpressionValue(manager, aliases.mouthEe, frame.mouthSpread * 0.8);
  setExpressionValue(manager, aliases.mouthOu, frame.mouthRound * 0.8);
  setExpressionValue(manager, aliases.mouthOh, Math.max(frame.mouthRound * 0.65, frame.jawOpen * 0.3));
  setExpressionValue(manager, aliases.jaw, Math.max(frame.jawOpen, frame.mouthRound * 0.25));
}

function applyAffectExpressions(
  manager: VrmExpressionManagerAccess | null,
  aliases: AvatarExpressionAliases,
  frame: AvatarPerformanceFrame
) {
  const relaxed = clamp01(frame.smile * 0.7 + frame.browInnerUp * 0.2);
  const surprised = clamp01(frame.browOuterUp * 0.8 + frame.browInnerUp * 0.4 + frame.jawOpen * 0.18);

  setExpressionValue(manager, aliases.happy, frame.smile);
  setExpressionValue(manager, aliases.relaxed, relaxed);
  setExpressionValue(manager, aliases.surprised, surprised);
}

function applyBlinkExpressions(
  manager: VrmExpressionManagerAccess | null,
  aliases: AvatarExpressionAliases,
  blink: number
) {
  setExpressionValue(manager, aliases.blink, blink);
  setExpressionValue(manager, aliases.blinkLeft, blink);
  setExpressionValue(manager, aliases.blinkRight, blink);
}

function applyGazeExpressions(
  manager: VrmExpressionManagerAccess | null,
  aliases: AvatarExpressionAliases,
  frame: AvatarPerformanceFrame
) {
  setExpressionValue(manager, aliases.lookLeft, frame.gazeYaw < 0 ? Math.abs(frame.gazeYaw) * 8 : 0);
  setExpressionValue(manager, aliases.lookRight, frame.gazeYaw > 0 ? frame.gazeYaw * 8 : 0);
  setExpressionValue(manager, aliases.lookUp, frame.gazePitch > 0 ? frame.gazePitch * 12 : 0);
  setExpressionValue(manager, aliases.lookDown, frame.gazePitch < 0 ? Math.abs(frame.gazePitch) * 12 : 0);
}

function formatDialogueState(dialogueState: AvatarDialogueState): string {
  switch (dialogueState) {
    case 'listening':
      return 'Listening';
    case 'thinking':
      return 'Thinking';
    case 'pre_speaking':
      return 'Preparing';
    case 'speaking':
      return 'Speaking';
    case 'post_speaking':
      return 'Settling';
    default:
      return 'Ready';
  }
}

type VrmAvatarOverlayProps = {
  effectiveStatus: PanelStatus;
  overlayStatus: string | null;
  fallbackSrc?: string;
  title: string;
  showDebug: boolean;
  avatarPerformance: AvatarPerformanceFrame;
  resolvedExpressionKeys: string[];
  onToggleDebug: () => void;
};

function VrmAvatarOverlay({
  effectiveStatus,
  overlayStatus,
  fallbackSrc,
  title,
  showDebug,
  avatarPerformance,
  resolvedExpressionKeys,
  onToggleDebug,
}: VrmAvatarOverlayProps) {
  return (
    <>
      {effectiveStatus !== 'ready' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          {fallbackSrc ? (
            <img src={fallbackSrc} alt={title} className="size-20 opacity-80" />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-2xl border-3 border-border bg-secondary">
              <span className="text-3xl">🧑‍🏫</span>
            </div>
          )}
          <div className="text-xs font-bold text-muted-foreground">{overlayStatus}</div>
        </div>
      ) : null}

      {effectiveStatus === 'ready' ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl border-2 border-border bg-card/80 px-2 py-1 text-[11px] font-bold text-muted-foreground backdrop-blur">
          {overlayStatus}
        </div>
      ) : null}

      {import.meta.env.DEV && effectiveStatus === 'ready' ? (
        <>
          <button
            type="button"
            onClick={onToggleDebug}
            className="absolute right-3 top-3 rounded-lg border-2 border-border bg-card/90 px-2 py-1 text-[10px] font-bold text-foreground shadow-stamp-sm"
          >
            {showDebug ? 'Hide Debug' : 'Show Debug'}
          </button>
          {showDebug ? (
            <div className="absolute bottom-3 right-3 max-w-[18rem] rounded-xl border-2 border-border bg-card/90 p-3 text-[10px] text-foreground shadow-stamp backdrop-blur">
              <div className="font-bold uppercase tracking-[0.12em] text-muted-foreground">Avatar Debug</div>
              <div className="mt-2 space-y-1">
                <div>State: {formatDialogueState(avatarPerformance.dialogueState)}</div>
                <div>Affect: {avatarPerformance.affect}</div>
                <div>Audio: {avatarPerformance.debug.audioLevel.toFixed(2)}</div>
                <div>Keys: {resolvedExpressionKeys.join(', ') || 'none'}</div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export default function VrmAvatarPanel({
  enabled,
  performance: avatarPerformance,
  modelUrl = DEFAULT_MODEL_URL,
  fallbackSrc,
  statusLabel,
  title = 'Virtual Avatar',
}: VrmAvatarPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const performanceRef = useRef(avatarPerformance);

  const webglSupported = useMemo(() => supportsWebGL(), []);
  const [panelState, dispatchPanel] = useReducer(
    vrmPanelReducer,
    createInitialVrmPanelState(enabled, webglSupported)
  );
  const { status, errorMessage, resolvedExpressionKeys, showDebug } = panelState;

  useEffect(() => {
    performanceRef.current = avatarPerformance;
  }, [avatarPerformance]);

  useEffect(() => {
    if (!enabled || !webglSupported) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    queueMicrotask(() => {
      dispatchPanel({ type: 'loading' });
    });

    let isDisposed = false;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const scene = new Scene();
    const camera = new PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 1.4, 1.8);

    let renderer: WebGLRenderer | null = null;
    try {
      renderer = new WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize WebGL renderer.';
      queueMicrotask(() => {
        dispatchPanel({ type: 'error', errorMessage: message });
      });
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;

    const hemi = new HemisphereLight(0xffffff, 0x202020, 0.9);
    hemi.position.set(0, 2, 0);
    scene.add(hemi);

    const dir = new DirectionalLight(0xffffff, 0.8);
    dir.position.set(1.5, 2.2, 2.0);
    scene.add(dir);

    const updateSize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0 || !renderer) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    updateSize();
    resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    const clock = new Clock();
    const rotationEuler = new Euler();
    const rotationQuat = new Quaternion();
    const expressionAliasesRef = { current: resolveExpressionAliases(undefined) };
    const expressionCapabilitiesRef = { current: getExpressionCapabilities(expressionAliasesRef.current) };

    let vrm: VRM | null = null;
    let torsoState: BoneMotionState | null = null;
    let neckState: BoneMotionState | null = null;
    let headState: BoneMotionState | null = null;
    let jawState: BoneMotionState | null = null;

    const applyBoneMotion = (
      state: BoneMotionState | null,
      rotationX = 0,
      rotationY = 0,
      rotationZ = 0,
      lift = 0
    ) => {
      if (!state) return;

      state.node.position.copy(state.position);
      state.node.position.y += lift;
      state.node.quaternion.copy(state.quaternion);

      rotationEuler.set(rotationX, rotationY, rotationZ, 'XYZ');
      rotationQuat.setFromEuler(rotationEuler);
      state.node.quaternion.multiply(rotationQuat);
    };

    const animate = () => {
      if (isDisposed || !renderer) return;

      rafId = window.requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (vrm) {
        const frame = performanceRef.current;
        const manager = resolveExpressionManager(vrm);
        const aliases = expressionAliasesRef.current;
        const capabilities = expressionCapabilitiesRef.current;
        const gazeFallbackYaw = capabilities.hasGaze ? 0 : frame.gazeYaw * 0.35;
        const gazeFallbackPitch = capabilities.hasGaze ? 0 : frame.gazePitch * 0.25;
        const jawFallback = capabilities.hasMouth || capabilities.hasJaw ? frame.jawOpen * 0.08 : frame.jawOpen * 0.18;

        resetControlledExpressions(manager, aliases);
        applyMouthExpressions(manager, aliases, frame);
        applyAffectExpressions(manager, aliases, frame);
        applyBlinkExpressions(manager, aliases, frame.blink);
        applyGazeExpressions(manager, aliases, frame);

        applyBoneMotion(
          torsoState,
          frame.chestPitch,
          gazeFallbackYaw * 0.2,
          0,
          frame.intensity * 0.003
        );
        applyBoneMotion(
          neckState,
          frame.neckPitch + gazeFallbackPitch * 0.18,
          frame.headYaw * 0.35 + gazeFallbackYaw * 0.2,
          frame.headRoll * 0.35,
          frame.intensity * 0.0015
        );
        applyBoneMotion(
          headState,
          frame.headPitch + gazeFallbackPitch,
          frame.headYaw + gazeFallbackYaw,
          frame.headRoll,
          frame.intensity * 0.002
        );
        applyBoneMotion(jawState, jawFallback, 0, 0);
        vrm.update(delta);
      }

      renderer.render(scene, camera);
    };

    const loader = new GLTFLoader();
    loader.register((parser: unknown) => new VRMLoaderPlugin(parser as never));

    loader.load(
      modelUrl,
      (gltf: GLTF) => {
        if (isDisposed) return;

        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);

        const loadedVrm = gltf.userData.vrm as VRM | undefined;
        if (!loadedVrm) {
          dispatchPanel({ type: 'error', errorMessage: 'Loaded model is not a valid VRM.' });
          return;
        }

        vrm = loadedVrm;
        torsoState =
          captureBoneMotionState(vrm, VRMHumanBoneName.UpperChest) ??
          captureBoneMotionState(vrm, VRMHumanBoneName.Chest) ??
          captureBoneMotionState(vrm, VRMHumanBoneName.Spine);
        neckState = captureBoneMotionState(vrm, VRMHumanBoneName.Neck);
        headState = captureBoneMotionState(vrm, VRMHumanBoneName.Head);
        jawState = captureBoneMotionState(vrm, VRMHumanBoneName.Jaw);

        const manager = resolveExpressionManager(vrm);
        const aliases = resolveExpressionAliases(manager?.expressionMap);
        expressionAliasesRef.current = aliases;
        expressionCapabilitiesRef.current = getExpressionCapabilities(aliases);
        const resolvedKeys = listResolvedExpressionKeys(aliases);

        vrm.scene.rotation.y = Math.PI;
        vrm.scene.traverse((obj: Object3D) => {
          obj.frustumCulled = false;
        });

        scene.add(vrm.scene);
        frameCameraToBust(vrm, camera);

        dispatchPanel({ type: 'ready', resolvedExpressionKeys: resolvedKeys });
      },
      undefined,
      (err: unknown) => {
        if (isDisposed) return;
        console.error('VRM load error:', err);
        dispatchPanel({
          type: 'error',
          errorMessage: 'Failed to load avatar model. Please check the VRM file path.',
        });
      }
    );

    animate();

    return () => {
      isDisposed = true;

      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      resizeObserver?.disconnect();
      resizeObserver = null;

      if (vrm) {
        try {
          scene.remove(vrm.scene);
        } catch {
          // ignore
        }
        const maybeDeepDispose = (VRMUtils as unknown as { deepDispose?: (obj: Object3D) => void }).deepDispose;
        if (maybeDeepDispose) {
          maybeDeepDispose(vrm.scene);
        } else {
          deepDispose(vrm.scene);
        }
        vrm = null;
      }

      try {
        renderer?.dispose();
      } catch {
        // ignore
      }

      renderer = null;
    };
  }, [enabled, modelUrl, webglSupported]);

  const effectiveStatus: PanelStatus = webglSupported ? status : 'error';
  const effectiveErrorMessage = webglSupported
    ? errorMessage
    : 'WebGL is not supported in this browser.';

  const overlayStatus = useMemo(() => {
    if (!enabled) return null;
    if (effectiveStatus === 'loading') return 'Loading avatar…';
    if (effectiveStatus === 'error') return effectiveErrorMessage ?? 'Avatar unavailable';
    if (statusLabel) return statusLabel;
    return formatDialogueState(avatarPerformance.dialogueState);
  }, [avatarPerformance.dialogueState, effectiveErrorMessage, effectiveStatus, enabled, statusLabel]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" />
      <VrmAvatarOverlay
        effectiveStatus={effectiveStatus}
        overlayStatus={overlayStatus}
        fallbackSrc={fallbackSrc}
        title={title}
        showDebug={showDebug}
        avatarPerformance={avatarPerformance}
        resolvedExpressionKeys={resolvedExpressionKeys}
        onToggleDebug={() => dispatchPanel({ type: 'toggleDebug' })}
      />
    </div>
  );
}
