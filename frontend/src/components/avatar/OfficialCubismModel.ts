import { CubismModelSettingJson } from '@cubism/cubismmodelsettingjson';
import { CubismFramework } from '@cubism/live2dcubismframework';
import { CubismMatrix44 } from '@cubism/math/cubismmatrix44';
import { CubismUserModel } from '@cubism/model/cubismusermodel';
import { ACubismMotion } from '@cubism/motion/acubismmotion';
import { CubismMotion } from '@cubism/motion/cubismmotion';
import { InvalidMotionQueueEntryHandleValue } from '@cubism/motion/cubismmotionqueuemanager';
import { csmMap } from '@cubism/type/csmmap';
import { csmVector } from '@cubism/type/csmvector';
import type { CubismIdHandle } from '@cubism/id/cubismid';
import type { Live2DManifest } from './live2dManifest';
import type { Live2DParameterTargets } from './live2dMapping';

const PRIORITY_IDLE = 1;
const PRIORITY_NORMAL = 2;
const PRIORITY_FORCE = 3;

type LoadedTexture = {
  id: WebGLTexture;
  width: number;
  height: number;
};

type Live2DViewportInsets = {
  topInsetPx?: number;
  rightInsetPx?: number;
  bottomInsetPx?: number;
  leftInsetPx?: number;
};

function getModelDirectory(modelJsonPath: string) {
  const lastSlash = modelJsonPath.lastIndexOf('/');
  return lastSlash === -1 ? '' : modelJsonPath.slice(0, lastSlash + 1);
}

async function fetchArrayBuffer(path: string) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.arrayBuffer();
}

function loadTexture(
  gl: WebGLRenderingContext,
  path: string,
  usePremultiply: boolean
): Promise<LoadedTexture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const texture = gl.createTexture();
      if (!texture) {
        reject(new Error(`Failed to create WebGL texture for ${path}`));
        return;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      if (usePremultiply) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      }

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      resolve({
        id: texture,
        width: image.width,
        height: image.height,
      });
    };
    image.onerror = () => reject(new Error(`Failed to load texture ${path}`));
    image.src = path;
  });
}

export class OfficialCubismModel extends CubismUserModel {
  private readonly gl: WebGLRenderingContext;
  private modelSetting: CubismModelSettingJson | null = null;
  private modelHomeDir = '';
  private expressions = new Map<string, ACubismMotion>();
  private motions = new Map<string, CubismMotion>();
  private eyeBlinkIds = new csmVector<CubismIdHandle>();
  private lipSyncIds = new csmVector<CubismIdHandle>();
  private parameterIdCache = new Map<string, CubismIdHandle>();
  private textures: WebGLTexture[] = [];
  private maxTextureHeight = 0;
  private availableMotionGroupsRecord: Record<string, number> = {};
  private availableExpressionsList: string[] = [];
  private availableHitAreasList: string[] = [];
  private ready = false;

  public constructor(gl: WebGLRenderingContext) {
    super();
    this.gl = gl;
    this._lipsync = false;
    this._debugMode = import.meta.env.DEV;
  }

  public async load(modelJsonPath: string) {
    this.modelHomeDir = getModelDirectory(modelJsonPath);
    const settingBuffer = await fetchArrayBuffer(modelJsonPath);
    const setting = new CubismModelSettingJson(settingBuffer, settingBuffer.byteLength);
    this.modelSetting = setting;

    const modelFileName = setting.getModelFileName();
    if (!modelFileName) {
      throw new Error('Live2D model file is missing from model3.json');
    }

    const modelBuffer = await fetchArrayBuffer(`${this.modelHomeDir}${modelFileName}`);
    this.loadModel(modelBuffer);

    await this.loadExpressions();
    await this.loadPhysicsAsset();
    await this.loadPoseAsset();
    await this.loadUserDataAsset();
    this.collectEffectIds();
    this.collectMetadata();
    await this.preloadMotions();

    this.createRenderer();
    this.getRenderer().startUp(this.gl);
    this.getRenderer().setIsPremultipliedAlpha(true);
    await this.loadTextures();

    this.setInitialized(true);
    this.setUpdating(false);
    this.ready = true;
  }

  public isReady() {
    return this.ready;
  }

  public getAvailableMotionGroups() {
    return { ...this.availableMotionGroupsRecord };
  }

  public getAvailableExpressions() {
    return [...this.availableExpressionsList];
  }

  public getAvailableHitAreas() {
    return [...this.availableHitAreasList];
  }

  public isMotionFinished() {
    return this._motionManager.isFinished();
  }

  public startMotion(group: string, index: number, priority = PRIORITY_NORMAL) {
    const motion = this.motions.get(`${group}:${index}`);
    if (!motion) return false;

    if (priority === PRIORITY_FORCE) {
      this._motionManager.setReservePriority(priority);
    } else if (!this._motionManager.reserveMotion(priority)) {
      return false;
    }

    return this._motionManager.startMotionPriority(motion, false, priority) !== InvalidMotionQueueEntryHandleValue;
  }

  public startIdleMotion(group: string, index: number) {
    return this.startMotion(group, index, PRIORITY_IDLE);
  }

  public setExpression(expressionId: string) {
    const expression = this.expressions.get(expressionId);
    if (!expression || !this._expressionManager) return false;
    this._expressionManager.startMotion(expression, false);
    return true;
  }

  /**
   * Dynamically frames the model within the safe area of the canvas.
   *
   * Auto-centering: the model's visual center (manifest.anchor) is placed at
   * the center of the safe area — no per-breakpoint position values needed.
   *
   * Auto-zoom: logicalViewHeight scales proportionally to the safe-area
   * fraction of the viewport, with portrait tightening for narrow screens.
   *
   * @param devicePixelRatio  Pass window.devicePixelRatio so CSS-pixel insets
   *                          are correctly scaled to the device-pixel canvas.
   */
  public resizeToCanvas(
    canvasWidth: number,
    canvasHeight: number,
    manifest: Live2DManifest,
    viewportInsets?: Live2DViewportInsets,
    devicePixelRatio?: number
  ) {
    if (!this.modelSetting || !this.getModel()) return;

    const modelMatrix = this.getModelMatrix();
    const ratio = canvasWidth / Math.max(1, canvasHeight);
    const dpr = devicePixelRatio ?? 1;
    const pad = manifest.viewportPaddingPx ?? { top: 0, right: 0, bottom: 0, left: 0 };

    // Safe area in device pixels (insets + padding are CSS pixels → scale by DPR)
    const safeLeftPx = Math.min(
      canvasWidth - 1,
      Math.max(0, ((viewportInsets?.leftInsetPx ?? 0) + pad.left) * dpr)
    );
    const safeRightPx = Math.min(
      canvasWidth - 1,
      Math.max(0, ((viewportInsets?.rightInsetPx ?? 0) + pad.right) * dpr)
    );
    const safeTopPx = Math.min(
      canvasHeight - 1,
      Math.max(0, ((viewportInsets?.topInsetPx ?? 0) + pad.top) * dpr)
    );
    const safeBottomPx = Math.min(
      canvasHeight - 1,
      Math.max(0, ((viewportInsets?.bottomInsetPx ?? 0) + pad.bottom) * dpr)
    );
    const safeWidthPx = Math.max(1, canvasWidth - safeLeftPx - safeRightPx);
    const safeHeightPx = Math.max(1, canvasHeight - safeTopPx - safeBottomPx);

    // Auto-center: place model anchor at the center of the safe area
    const safeCenterXNorm = (safeLeftPx + safeWidthPx * 0.5) / Math.max(1, canvasWidth);
    const safeCenterYNorm = (safeTopPx + safeHeightPx * 0.5) / Math.max(1, canvasHeight);
    const anchorX = (safeCenterXNorm - 0.5) * 2 * ratio;
    const anchorY = (0.5 - safeCenterYNorm) * 2;

    // Auto-zoom: scale logicalViewHeight proportionally to safe-area fraction.
    // baseHeight was calibrated at ~0.88 safe fraction (typical desktop with HUD).
    const safeFraction = safeHeightPx / Math.max(1, canvasHeight);
    const baseHeight = manifest.logicalViewHeight ?? 1.88;
    const REF_SAFE_FRACTION = 0.88;
    let logicalHeight = baseHeight * (safeFraction / REF_SAFE_FRACTION);

    // Portrait tightening: zoom in on narrow viewports so the character
    // fills more of the visible area instead of becoming tiny.
    const safeAspect = safeWidthPx / Math.max(1, safeHeightPx);
    if (safeAspect < 0.9) {
      const t = safeAspect / 0.9;
      logicalHeight *= 0.65 + 0.35 * t;
    }

    modelMatrix.loadIdentity();
    modelMatrix.setHeight(logicalHeight);

    const scaledWidth = this.getModel().getCanvasWidth() * modelMatrix.getScaleX();
    const scaledHeight = this.getModel().getCanvasHeight() * modelMatrix.getScaleY();

    const anchor = manifest.anchor ?? { x: 0.5, y: 0.5 };
    modelMatrix.left(anchorX - scaledWidth * anchor.x);
    modelMatrix.top(anchorY - scaledHeight * anchor.y);
  }

  public getParameterValues(parameterIds: string[]) {
    if (!this.ready) {
      return Object.fromEntries(parameterIds.map((parameterId) => [parameterId, null])) as Record<string, number | null>;
    }

    const model = this.getModel();
    return Object.fromEntries(
      parameterIds.map((parameterId) => [
        parameterId,
        model.getParameterValueById(this.resolveParameterId(parameterId)),
      ])
    ) as Record<string, number | null>;
  }

  public update(deltaSeconds: number, targets: Live2DParameterTargets) {
    if (!this.ready) return;

    const dt = Math.min(0.05, Math.max(1 / 240, deltaSeconds || 1 / 60));
    const model = this.getModel();

    model.loadParameters();
    this._motionManager.updateMotion(model, dt);
    model.saveParameters();

    if (this._expressionManager) {
      this._expressionManager.updateMotion(model, dt);
    }

    if (this._physics) {
      this._physics.evaluate(model, dt);
    }

    if (this._pose) {
      this._pose.updateParameters(model, dt);
    }

    for (const [parameterId, value] of Object.entries(targets.values)) {
      model.setParameterValueById(this.resolveParameterId(parameterId), value);
    }

    model.update();
  }

  public draw(canvasWidth: number, canvasHeight: number) {
    if (!this.ready) return;

    const ratio = canvasWidth / Math.max(1, canvasHeight);
    const projection = new CubismMatrix44();
    projection.scale(1 / ratio, 1);

    const matrix = new CubismMatrix44();
    matrix.setMatrix(new Float32Array(projection.getArray()));
    matrix.multiplyByMatrix(this.getModelMatrix());

    const renderer = this.getRenderer();
    renderer.setRenderState(null as unknown as WebGLFramebuffer, [0, 0, canvasWidth, canvasHeight]);
    renderer.setMvpMatrix(matrix);
    renderer.drawModel();
  }

  public deviceToView(deviceX: number, deviceY: number, canvasWidth: number, canvasHeight: number) {
    const logicalScale = 2 / Math.max(1, canvasHeight);
    return {
      x: (deviceX - canvasWidth * 0.5) * logicalScale,
      y: (canvasHeight * 0.5 - deviceY) * logicalScale,
    };
  }

  public hitTest(viewX: number, viewY: number) {
    if (!this.modelSetting) return [];

    const hits: string[] = [];
    const hitAreaCount = this.modelSetting.getHitAreasCount();
    for (let index = 0; index < hitAreaCount; index += 1) {
      const name = this.modelSetting.getHitAreaName(index);
      const id = this.modelSetting.getHitAreaId(index);
      if (this.isHit(id, viewX, viewY)) {
        hits.push(name);
      }
    }

    return hits;
  }

  public release() {
    for (const texture of this.textures) {
      this.gl.deleteTexture(texture);
    }
    this.textures = [];

    for (const motion of this.motions.values()) {
      ACubismMotion.delete(motion);
    }
    this.motions.clear();

    for (const expression of this.expressions.values()) {
      ACubismMotion.delete(expression);
    }
    this.expressions.clear();

    this.ready = false;
    super.release();
  }

  private resolveParameterId(parameterId: string) {
    const existing = this.parameterIdCache.get(parameterId);
    if (existing) return existing;

    const resolved = CubismFramework.getIdManager().getId(parameterId);
    this.parameterIdCache.set(parameterId, resolved);
    return resolved;
  }

  private async loadExpressions() {
    if (!this.modelSetting) return;

    const count = this.modelSetting.getExpressionCount();
    for (let index = 0; index < count; index += 1) {
      const name = this.modelSetting.getExpressionName(index);
      const fileName = this.modelSetting.getExpressionFileName(index);
      if (!name || !fileName) continue;

      const buffer = await fetchArrayBuffer(`${this.modelHomeDir}${fileName}`);
      const expression = this.loadExpression(buffer, buffer.byteLength, name);
      if (expression) {
        this.expressions.set(name, expression);
      }
    }
  }

  private async loadPhysicsAsset() {
    if (!this.modelSetting) return;

    const fileName = this.modelSetting.getPhysicsFileName();
    if (!fileName) return;

    const buffer = await fetchArrayBuffer(`${this.modelHomeDir}${fileName}`);
    super.loadPhysics(buffer, buffer.byteLength);
  }

  private async loadPoseAsset() {
    if (!this.modelSetting) return;

    const fileName = this.modelSetting.getPoseFileName();
    if (!fileName) return;

    const buffer = await fetchArrayBuffer(`${this.modelHomeDir}${fileName}`);
    super.loadPose(buffer, buffer.byteLength);
  }

  private async loadUserDataAsset() {
    if (!this.modelSetting) return;

    const fileName = this.modelSetting.getUserDataFile();
    if (!fileName) return;

    const buffer = await fetchArrayBuffer(`${this.modelHomeDir}${fileName}`);
    super.loadUserData(buffer, buffer.byteLength);
  }

  private collectEffectIds() {
    if (!this.modelSetting) return;

    const eyeBlinkCount = this.modelSetting.getEyeBlinkParameterCount();
    for (let index = 0; index < eyeBlinkCount; index += 1) {
      this.eyeBlinkIds.pushBack(this.modelSetting.getEyeBlinkParameterId(index));
    }

    const lipSyncCount = this.modelSetting.getLipSyncParameterCount();
    for (let index = 0; index < lipSyncCount; index += 1) {
      this.lipSyncIds.pushBack(this.modelSetting.getLipSyncParameterId(index));
    }
  }

  private collectMetadata() {
    if (!this.modelSetting) return;

    this.availableMotionGroupsRecord = {};
    const groupCount = this.modelSetting.getMotionGroupCount();
    for (let index = 0; index < groupCount; index += 1) {
      const groupName = this.modelSetting.getMotionGroupName(index);
      this.availableMotionGroupsRecord[groupName] = this.modelSetting.getMotionCount(groupName);
    }

    this.availableExpressionsList = [];
    const expressionCount = this.modelSetting.getExpressionCount();
    for (let index = 0; index < expressionCount; index += 1) {
      this.availableExpressionsList.push(this.modelSetting.getExpressionName(index));
    }

    this.availableHitAreasList = [];
    const hitAreaCount = this.modelSetting.getHitAreasCount();
    for (let index = 0; index < hitAreaCount; index += 1) {
      this.availableHitAreasList.push(this.modelSetting.getHitAreaName(index));
    }
  }

  private async preloadMotions() {
    if (!this.modelSetting) return;

    const motionGroupCount = this.modelSetting.getMotionGroupCount();
    for (let groupIndex = 0; groupIndex < motionGroupCount; groupIndex += 1) {
      const groupName = this.modelSetting.getMotionGroupName(groupIndex);
      const motionCount = this.modelSetting.getMotionCount(groupName);

      for (let motionIndex = 0; motionIndex < motionCount; motionIndex += 1) {
        const fileName = this.modelSetting.getMotionFileName(groupName, motionIndex);
        if (!fileName) continue;

        const buffer = await fetchArrayBuffer(`${this.modelHomeDir}${fileName}`);
        const motion = this.loadMotion(
          buffer,
          buffer.byteLength,
          `${groupName}:${motionIndex}`,
          undefined,
          undefined,
          this.modelSetting,
          groupName,
          motionIndex
        );

        if (motion) {
          motion.setEffectIds(this.eyeBlinkIds, this.lipSyncIds);
          this.motions.set(`${groupName}:${motionIndex}`, motion);
        }
      }
    }
  }

  private async loadTextures() {
    if (!this.modelSetting) return;

    const textureCount = this.modelSetting.getTextureCount();
    for (let index = 0; index < textureCount; index += 1) {
      const fileName = this.modelSetting.getTextureFileName(index);
      if (!fileName) continue;

      const texture = await loadTexture(this.gl, `${this.modelHomeDir}${fileName}`, true);
      this.textures.push(texture.id);
      this.maxTextureHeight = Math.max(this.maxTextureHeight, texture.height);
      this.getRenderer().bindTexture(index, texture.id);
    }

    const layout = new csmMap<string, number>();
    this.modelSetting.getLayoutMap(layout);
    if (layout.getSize() > 0) {
      this.getModelMatrix().setupFromLayout(layout);
    }
  }
}
