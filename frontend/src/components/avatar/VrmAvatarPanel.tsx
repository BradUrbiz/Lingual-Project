import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanBoneName, VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { useAudioRms } from './useAudioRms';
import { clamp01 } from './rms';

type ChatMode = 'text' | 'realtime';

type VrmAvatarPanelProps = {
  enabled: boolean;
  mode: ChatMode;
  isSpeaking: boolean;
  isListening: boolean;
  remoteAudioStream: MediaStream | null;
  modelUrl?: string;
  fallbackSrc?: string;
  title?: string;
};

type PanelStatus = 'idle' | 'loading' | 'ready' | 'error';

const DEFAULT_MODEL_URL = '/avatars/lingual-teacher.vrm';
const MOUTH_KEYS = ['aa', 'A'] as const;
const BLINK_KEYS = ['blink', 'Blink'] as const;

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function disposeMaterial(material: THREE.Material) {
  const maybeAnyMaterial = material as unknown as Record<string, unknown>;
  for (const value of Object.values(maybeAnyMaterial)) {
    if (value && typeof value === 'object' && value instanceof THREE.Texture) {
      value.dispose();
    }
  }
  material.dispose();
}

function deepDispose(object: THREE.Object3D) {
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
      return;
    }
    disposeMaterial(material);
  });
}

function getBoneWorldPosition(vrm: VRM, boneName: VRMHumanBoneName): THREE.Vector3 | null {
  const humanoid = (vrm as unknown as { humanoid?: unknown }).humanoid as
    | {
        getNormalizedBoneNode?: (name: VRMHumanBoneName) => THREE.Object3D | null;
        getBoneNode?: (name: VRMHumanBoneName) => THREE.Object3D | null;
      }
    | undefined;

  const boneNode = humanoid?.getNormalizedBoneNode?.(boneName) ?? humanoid?.getBoneNode?.(boneName) ?? null;
  if (!boneNode) return null;

  const position = new THREE.Vector3();
  boneNode.getWorldPosition(position);
  return position;
}

function frameCameraToBust(vrm: VRM, camera: THREE.PerspectiveCamera) {
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

  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const target = center.clone();
  target.y += size.y * 0.2;

  const maxDim = Math.max(size.x, size.y, size.z);
  const halfFovRadians = THREE.MathUtils.degToRad(camera.fov / 2);
  const distance = maxDim / Math.tan(halfFovRadians);

  camera.position.set(center.x, target.y, center.z + distance * 0.65);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function setExpression(vrm: VRM, keys: readonly string[], value: number) {
  const manager = (vrm as unknown as { expressionManager?: unknown; blendShapeProxy?: unknown })
    .expressionManager ??
    (vrm as unknown as { expressionManager?: unknown; blendShapeProxy?: unknown }).blendShapeProxy;

  const mgr = manager as { setValue?: (name: string, value: number) => void } | null | undefined;
  if (!mgr?.setValue) return;

  const clamped = clamp01(value);
  for (const key of keys) {
    try {
      mgr.setValue(key, clamped);
    } catch {
      // ignore unknown keys
    }
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export default function VrmAvatarPanel({
  enabled,
  mode,
  isSpeaking,
  isListening,
  remoteAudioStream,
  modelUrl = DEFAULT_MODEL_URL,
  fallbackSrc,
  title = 'Virtual Avatar',
}: VrmAvatarPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [webglSupported] = useState(() => supportsWebGL());
  const [status, setStatus] = useState<PanelStatus>(() => (enabled && webglSupported ? 'loading' : 'idle'));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const analysisEnabled = useMemo(
    () => enabled && mode === 'realtime' && Boolean(remoteAudioStream),
    [enabled, mode, remoteAudioStream]
  );
  const { rmsLevelRef } = useAudioRms(remoteAudioStream, analysisEnabled);

  const speakingRef = useRef(isSpeaking);
  const listeningRef = useRef(isListening);
  useEffect(() => {
    speakingRef.current = isSpeaking;
  }, [isSpeaking]);
  useEffect(() => {
    listeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    if (!enabled || !webglSupported) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let isDisposed = false;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 1.4, 1.8);

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize WebGL renderer.';
      queueMicrotask(() => {
        setStatus('error');
        setErrorMessage(message);
      });
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.9);
    hemi.position.set(0, 2, 0);
    scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
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

    const clock = new THREE.Clock();
    let vrm: VRM | null = null;

    const blinkState = {
      nextBlinkAt: performance.now() + randomBetween(2500, 6000),
      isBlinking: false,
      blinkStartAt: 0,
      blinkDurationMs: 140,
    };

    const animate = () => {
      if (isDisposed || !renderer) return;

      rafId = window.requestAnimationFrame(animate);

      const delta = clock.getDelta();
      if (vrm) {
        const now = performance.now();

        if (!blinkState.isBlinking && now >= blinkState.nextBlinkAt) {
          blinkState.isBlinking = true;
          blinkState.blinkStartAt = now;
          blinkState.blinkDurationMs = randomBetween(120, 160);
        }

        let blinkValue = 0;
        if (blinkState.isBlinking) {
          const t = (now - blinkState.blinkStartAt) / blinkState.blinkDurationMs;
          if (t >= 1) {
            blinkState.isBlinking = false;
            blinkState.nextBlinkAt = now + randomBetween(2500, 6000);
            blinkValue = 0;
          } else {
            const phase = t < 0.5 ? t * 2 : (1 - t) * 2;
            blinkValue = clamp01(phase * phase);
          }
        }

        const mouth = speakingRef.current ? rmsLevelRef.current : 0;

        setExpression(vrm, MOUTH_KEYS, mouth);
        setExpression(vrm, BLINK_KEYS, blinkValue);

        // Optional micro-feedback: slightly open mouth while listening (helps "alive" feel).
        if (!speakingRef.current && listeningRef.current) {
          setExpression(vrm, MOUTH_KEYS, Math.max(mouth, 0.03));
        }

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
        VRMUtils.removeUnnecessaryJoints(gltf.scene);

        const loadedVrm = gltf.userData.vrm as VRM | undefined;
        if (!loadedVrm) {
          setErrorMessage('Loaded model is not a valid VRM.');
          setStatus('error');
          return;
        }

        vrm = loadedVrm;
        vrm.scene.rotation.y = Math.PI;
        vrm.scene.traverse((obj: THREE.Object3D) => {
          obj.frustumCulled = false;
        });

        scene.add(vrm.scene);
        frameCameraToBust(vrm, camera);

        setErrorMessage(null);
        setStatus('ready');
      },
      undefined,
      (err: unknown) => {
        if (isDisposed) return;
        console.error('VRM load error:', err);
        setStatus('error');
        setErrorMessage('Failed to load avatar model. Please check the VRM file path.');
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
        const maybeDeepDispose = (VRMUtils as unknown as { deepDispose?: (obj: THREE.Object3D) => void }).deepDispose;
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

    if (mode !== 'realtime') return 'Text mode';
    if (isSpeaking) return 'Speaking';
    if (isListening) return 'Listening';
    return 'Ready';
  }, [effectiveErrorMessage, effectiveStatus, enabled, isListening, isSpeaking, mode]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" />

      {effectiveStatus !== 'ready' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          {fallbackSrc ? (
            <img src={fallbackSrc} alt={title} className="h-20 w-20 opacity-80" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-3 border-border bg-secondary">
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
    </div>
  );
}
