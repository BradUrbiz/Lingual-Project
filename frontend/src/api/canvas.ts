import api from './index';
import type {
  CanvasConnectResult,
  CanvasConnectionStatus,
  CanvasCourseContentItem,
  CanvasSyncResult,
  CanvasValidateResult,
} from '@/types/canvas';

export const validateCanvasConnection = async (
  canvasInstanceUrl: string,
  pat: string,
): Promise<CanvasValidateResult> => {
  const response = await api.post<CanvasValidateResult>(
    '/integrations/canvas/validate',
    { canvasInstanceUrl, pat },
  );
  return response.data;
};

export const connectCanvas = async (payload: {
  canvasInstanceUrl: string;
  pat: string;
  canvasCourseId: string;
  canvasCourseName: string;
  existingClassId?: string;
}): Promise<CanvasConnectResult> => {
  const response = await api.post<CanvasConnectResult>(
    '/integrations/canvas/connect',
    payload,
  );
  return response.data;
};

export const getCanvasStatus = async (
  classId: string,
): Promise<CanvasConnectionStatus> => {
  const response = await api.get<CanvasConnectionStatus>(
    `/teacher/classes/${classId}/canvas/status`,
  );
  return response.data;
};

export const syncCanvas = async (
  classId: string,
): Promise<CanvasSyncResult> => {
  const response = await api.post<CanvasSyncResult>(
    `/teacher/classes/${classId}/canvas/sync`,
  );
  return response.data;
};

export const disconnectCanvas = async (
  classId: string,
): Promise<{ success: boolean }> => {
  const response = await api.delete<{ success: boolean }>(
    `/teacher/classes/${classId}/canvas/disconnect`,
  );
  return response.data;
};

export const getCanvasContentForClass = async (
  classId: string,
): Promise<CanvasCourseContentItem[]> => {
  const response = await api.get<{ items: CanvasCourseContentItem[] }>(
    `/teacher/classes/${classId}/canvas/content`,
  );
  return response.data.items;
};

export const getStudentCanvasContent = async (
  classId: string,
): Promise<CanvasCourseContentItem[]> => {
  const response = await api.get<{ items: CanvasCourseContentItem[] }>(
    `/student/classes/${classId}/canvas/content`,
  );
  return response.data.items;
};

export const linkAssignmentToCanvas = async (
  assignmentId: string,
  canvasContentId: string,
  canvasModuleItemId: string,
): Promise<{ success: boolean }> => {
  const response = await api.post<{ success: boolean }>(
    `/teacher/assignments/${assignmentId}/canvas-link`,
    { canvasContentId, canvasModuleItemId },
  );
  return response.data;
};

export const unlinkAssignmentFromCanvas = async (
  assignmentId: string,
  canvasContentId: string,
): Promise<{ success: boolean }> => {
  const response = await api.delete<{ success: boolean }>(
    `/teacher/assignments/${assignmentId}/canvas-link`,
    { data: { canvasContentId } },
  );
  return response.data;
};
